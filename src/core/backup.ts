import type { InfoEntry, NutritionType, RecipeSnapshot, SourceType } from './models';
import { NUTRITION, SOURCES } from './models';

export const APP_ID = 'c2c-003-information-recipe';
export const BACKUP_KIND = 'information-recipe-backup';
export const BACKUP_VERSION = 1;
const DEFAULT_DAILY_GOAL = 150;
const DEFAULT_MINUTES = 20;

export class BackupFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'BackupFormatError'; }
}

export interface BackupFile {
  app: string;
  kind: string;
  version: number;
  exportedAt: string;
  data: RecipeSnapshot;
}

export interface MergeResult {
  snapshot: RecipeSnapshot;
  added: number;
  skipped: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function today(): string { return new Date().toISOString().slice(0, 10); }

/** 把当前数据打包成本应用的备份文件结构 */
export function createBackup(snapshot: RecipeSnapshot): BackupFile {
  return {
    app: APP_ID,
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { entries: snapshot.entries, dailyGoal: snapshot.dailyGoal },
  };
}

export function backupFilename(now = new Date()): string {
  return `information-recipe-backup-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * 兼容旧版本数据：单条记录缺失字段时按默认值补齐，
 * 无法识别的枚举值回退到首选项，整条损坏（非对象）时返回 null 由上层丢弃。
 */
function normalizeEntry(value: unknown, index: number): InfoEntry | null {
  if (!isPlainObject(value)) return null;
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '未命名内容';
  const source = (SOURCES as string[]).includes(value.source as string) ? value.source as SourceType : '文章';
  const nutrition = (NUTRITION as string[]).includes(value.nutrition as string) ? value.nutrition as NutritionType : '深度知识';
  const minutes = typeof value.minutes === 'number' && Number.isFinite(value.minutes)
    ? Math.max(0, Math.round(value.minutes))
    : DEFAULT_MINUTES;
  const date = typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : today();
  const note = typeof value.note === 'string' ? value.note : '';
  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id
    : `imported-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
  return { id, title, source, nutrition, minutes, date, note };
}

function normalizeGoal(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_DAILY_GOAL;
}

/** 缺失字段的旧版本快照按默认值补齐，而不是报错 */
export function normalizeSnapshot(value: unknown): RecipeSnapshot {
  const data = isPlainObject(value) ? value : {};
  const entries = Array.isArray(data.entries)
    ? data.entries
      .map((item, index) => normalizeEntry(item, index))
      .filter((item): item is InfoEntry => item !== null)
    : [];
  return { entries, dailyGoal: normalizeGoal(data.dailyGoal) };
}

/**
 * 校验文件是否本应用导出的备份：
 * 优先识别带 app/kind 标记的备份信封；
 * 兼容没有信封、直接是数据快照的更旧导出。
 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new BackupFormatError('文件不是有效的 JSON，无法导入。');
  }
  if (!isPlainObject(raw)) throw new BackupFormatError('文件内容无效，不是本应用导出的备份文件。');

  if (raw.app !== APP_ID || raw.kind !== BACKUP_KIND) {
    // 只有完全不带应用标记的裸快照才按旧版本兼容；带了其他应用标记的文件直接拒绝
    const hasForeignMark = raw.app !== undefined || raw.kind !== undefined;
    if (!hasForeignMark && Array.isArray(raw.entries)) {
      return { app: APP_ID, kind: BACKUP_KIND, version: 0, exportedAt: '', data: normalizeSnapshot(raw) };
    }
    throw new BackupFormatError('该文件不是「信息食谱调配师」导出的备份文件，已取消导入。');
  }

  const version = typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 1;
  const exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : '';
  // data 缺失时退回信封本身（旧版本可能把字段平铺），再交给 normalize 补齐
  const payload = isPlainObject(raw.data) ? raw.data : raw;
  return { app: APP_ID, kind: BACKUP_KIND, version, exportedAt, data: normalizeSnapshot(payload) };
}

/** 内容指纹：id 之外，同日期/标题/来源/营养/时长/备注也视为同一条记录 */
export function entryFingerprint(entry: InfoEntry): string {
  return [entry.date, entry.title.trim(), entry.source, entry.nutrition, entry.minutes, entry.note.trim()].join('|');
}

/** 合并：以本地为基础追加备份记录，id 或内容指纹重复的跳过，保证不重复计数；每日目标保留本地设置 */
export function mergeSnapshots(local: RecipeSnapshot, incoming: RecipeSnapshot): MergeResult {
  const fingerprints = new Set(local.entries.map(entryFingerprint));
  const ids = new Set(local.entries.map((entry) => entry.id));
  const entries = [...local.entries];
  let added = 0;
  let skipped = 0;
  for (const entry of incoming.entries) {
    if (ids.has(entry.id) || fingerprints.has(entryFingerprint(entry))) {
      skipped += 1;
      continue;
    }
    ids.add(entry.id);
    fingerprints.add(entryFingerprint(entry));
    entries.push(entry);
    added += 1;
  }
  return { snapshot: { entries, dailyGoal: local.dailyGoal }, added, skipped };
}

/** 统计备份中与本地冲突（id 或内容指纹重复）的记录数，为 0 时可直接合入 */
export function countDuplicates(localEntries: InfoEntry[], incomingEntries: InfoEntry[]): number {
  const fingerprints = new Set(localEntries.map(entryFingerprint));
  const ids = new Set(localEntries.map((entry) => entry.id));
  return incomingEntries.reduce(
    (count, entry) => count + (ids.has(entry.id) || fingerprints.has(entryFingerprint(entry)) ? 1 : 0),
    0,
  );
}
