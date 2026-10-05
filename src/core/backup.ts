import type { InfoEntry, NutritionType, RecipeSnapshot, SourceType } from './models';
import { NUTRITION, SOURCES } from './models';

/** 备份文件中的应用标识，导入时据此校验文件是否由本应用导出 */
export const BACKUP_APP = 'c2c-003-information-recipe';
/** 当前备份格式版本。旧版本备份缺失字段时按默认值补齐，而不是拒绝导入 */
export const BACKUP_VERSION = 2;

const DEFAULT_DAILY_GOAL = 150;
const DEFAULT_SOURCE: SourceType = '文章';
const DEFAULT_NUTRITION: NutritionType = '深度知识';

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  data: RecipeSnapshot;
}

export interface ParseSuccess {
  ok: true;
  snapshot: RecipeSnapshot;
  /** 被默认值补齐的字段个数（旧版本备份会大于 0） */
  repaired: number;
  /** 因完全无法识别而被丢弃的记录条数 */
  skipped: number;
  warnings: string[];
}
export type ParseResult = ParseSuccess | { ok: false; error: string };

export interface MergeResult {
  snapshot: RecipeSnapshot;
  /** 实际追加的记录条数 */
  added: number;
  /** 与本地重复而被跳过的记录条数 */
  skipped: number;
}

/** 把当前快照包装成带标识与版本号的备份对象 */
export function createBackup(snapshot: RecipeSnapshot): BackupFile {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data: snapshot };
}

export function serializeBackup(snapshot: RecipeSnapshot): string {
  return JSON.stringify(createBackup(snapshot), null, 2);
}

/** 内容指纹：id 之外的第二道判重，防止不同设备各自生成的同一条记录被重复计数 */
export function entryFingerprint(entry: InfoEntry): string {
  return [entry.title, entry.source, entry.nutrition, entry.minutes, entry.date].join('|');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  return Number.isNaN(Date.parse(candidate)) ? null : candidate;
}

function sanitizeMinutes(value: unknown): number | null {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 1 ? Math.round(minutes) : null;
}

/** 清洗单条记录：缺失或无效字段按默认值补齐；完全不是对象时才丢弃 */
function sanitizeEntry(raw: unknown, index: number): { entry: InfoEntry; repaired: number } | null {
  if (!isRecord(raw)) return null;
  let repaired = 0;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : `imported-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
  if (id !== raw.id) repaired += 1;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '未命名内容';
  if (title !== raw.title) repaired += 1;
  const source = SOURCES.includes(raw.source as SourceType) ? (raw.source as SourceType) : DEFAULT_SOURCE;
  if (source !== raw.source) repaired += 1;
  const nutrition = NUTRITION.includes(raw.nutrition as NutritionType) ? (raw.nutrition as NutritionType) : DEFAULT_NUTRITION;
  if (nutrition !== raw.nutrition) repaired += 1;
  const minutes = sanitizeMinutes(raw.minutes);
  if (minutes === null) repaired += 1;
  const date = sanitizeDate(raw.date);
  if (date === null) repaired += 1;
  const note = typeof raw.note === 'string' ? raw.note : '';
  if (note !== raw.note) repaired += 1;
  return { entry: { id, title, source, nutrition, minutes: minutes ?? 1, date: date ?? new Date().toISOString().slice(0, 10), note }, repaired };
}

/**
 * 解析并校验备份文件。
 * 硬校验（失败即拒绝）：不是 JSON、缺少应用标识、缺少摄入记录数组。
 * 软修复（不拒绝）：旧版本缺失字段、字段类型不对，一律按默认值补齐。
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON，请选择本应用导出的备份文件。' };
  }
  if (!isRecord(raw)) return { ok: false, error: '文件内容不是本应用的备份格式。' };
  if (raw.app !== BACKUP_APP) return { ok: false, error: '这不是「信息食谱调配师」导出的备份文件，已取消导入。' };
  if (!isRecord(raw.data)) return { ok: false, error: '备份文件缺少数据内容，文件可能已损坏。' };
  if (!Array.isArray(raw.data.entries)) return { ok: false, error: '备份文件中没有找到摄入记录，文件可能已损坏。' };

  const warnings: string[] = [];
  const version = typeof raw.version === 'number' ? raw.version : 1;
  if (version > BACKUP_VERSION) warnings.push('备份由更新版本的应用导出，已按当前版本可识别的字段读取。');

  let repaired = 0;
  let skipped = 0;
  const entries: InfoEntry[] = [];
  raw.data.entries.forEach((item, index) => {
    const result = sanitizeEntry(item, index);
    if (!result) { skipped += 1; return; }
    repaired += result.repaired;
    entries.push(result.entry);
  });

  const goal = Number(raw.data.dailyGoal);
  const dailyGoal = Number.isFinite(goal) && goal > 0 ? Math.round(goal) : DEFAULT_DAILY_GOAL;
  if (dailyGoal !== raw.data.dailyGoal) repaired += 1;

  if (repaired > 0) warnings.push(`检测到旧版本或缺失字段，已按默认值补齐 ${repaired} 处。`);
  if (skipped > 0) warnings.push(`有 ${skipped} 条记录完全无法识别，已忽略。`);

  return { ok: true, snapshot: { entries, dailyGoal }, repaired, skipped, warnings };
}

/**
 * 合并两份快照：本地数据全部保留，备份中与本地不重复的记录追加到最前。
 * 每日目标保留本地设置；判重先比 id，再比内容指纹，保证重复记录不会被重复计数。
 */
export function mergeSnapshots(local: RecipeSnapshot, imported: RecipeSnapshot): MergeResult {
  const ids = new Set(local.entries.map((item) => item.id));
  const fingerprints = new Set(local.entries.map(entryFingerprint));
  const additions: InfoEntry[] = [];
  let skipped = 0;
  for (const entry of imported.entries) {
    const fingerprint = entryFingerprint(entry);
    if (ids.has(entry.id) || fingerprints.has(fingerprint)) { skipped += 1; continue; }
    ids.add(entry.id);
    fingerprints.add(fingerprint);
    additions.push(entry);
  }
  return { snapshot: { entries: [...additions, ...local.entries], dailyGoal: local.dailyGoal }, added: additions.length, skipped };
}
