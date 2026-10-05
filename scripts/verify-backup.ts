import assert from 'node:assert';
import {
  BackupFormatError,
  backupFilename,
  countDuplicates,
  createBackup,
  entryFingerprint,
  mergeSnapshots,
  parseBackup,
} from '../src/core/backup';
import { sampleSnapshot } from '../src/core/recipe-engine';
import type { RecipeSnapshot } from '../src/core/models';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log('✓', name);
}

const local: RecipeSnapshot = {
  dailyGoal: 150,
  entries: [
    { id: 'a', title: '深度好文', source: '文章', nutrition: '深度知识', minutes: 40, date: '2026-10-01', note: '' },
    { id: 'b', title: '播客一期', source: '播客', nutrition: '行业动态', minutes: 30, date: '2026-10-02', note: 'x' },
  ],
};

// 1. 导出 -> 导入 往返
check('导出的备份可以原样解析', () => {
  const backup = createBackup(local);
  assert.equal(backup.app, 'c2c-003-information-recipe');
  assert.equal(backup.kind, 'information-recipe-backup');
  assert.equal(backup.version, 1);
  const parsed = parseBackup(JSON.stringify(backup));
  assert.deepEqual(parsed.data, local);
  assert.match(backupFilename(new Date('2026-10-05T08:00:00Z')), /^information-recipe-backup-2026-10-05\.json$/);
});

// 2. 格式校验
check('非 JSON 文件被拒绝', () => {
  assert.throws(() => parseBackup('not json at all'), BackupFormatError);
});
check('其他应用的 JSON 被拒绝', () => {
  assert.throws(() => parseBackup(JSON.stringify({ app: 'other-app', kind: 'whatever', entries: [] })), BackupFormatError);
});
check('随机 JSON 对象被拒绝', () => {
  assert.throws(() => parseBackup(JSON.stringify({ hello: 'world' })), BackupFormatError);
});

// 3. 旧版本：无备份信封的裸快照可导入
check('旧版本裸快照可兼容导入', () => {
  const legacy = { dailyGoal: 120, entries: [{ id: 'z', title: '老内容', source: '文章', nutrition: '深度知识', minutes: 10, date: '2026-09-01', note: '' }] };
  const parsed = parseBackup(JSON.stringify(legacy));
  assert.equal(parsed.version, 0);
  assert.equal(parsed.data.dailyGoal, 120);
  assert.equal(parsed.data.entries.length, 1);
});

// 4. 缺失字段按默认值补齐
check('条目缺失字段时按默认值补齐而不是报错', () => {
  const parsed = parseBackup(JSON.stringify(createBackup({ dailyGoal: 0, entries: [{}] })));
  assert.equal(parsed.data.dailyGoal, 150); // 目标缺失/非法 -> 默认
  const e = parsed.data.entries[0];
  assert.equal(e.title, '未命名内容');
  assert.equal(e.source, '文章');
  assert.equal(e.nutrition, '深度知识');
  assert.equal(e.minutes, 20);
  assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(e.note, '');
  assert.ok(e.id.startsWith('imported-'));
});
check('非法枚举值回退默认，损坏条目被丢弃，entries 整体缺失时为空数组', () => {
  const parsed = parseBackup(JSON.stringify({
    app: 'c2c-003-information-recipe', kind: 'information-recipe-backup', version: 1,
    data: { entries: [{ id: 'ok', title: 'x', source: '不存在的来源', nutrition: 999, minutes: 'bad' }, 'broken', 42] },
  }));
  assert.equal(parsed.data.entries.length, 1);
  assert.equal(parsed.data.entries[0].source, '文章');
  assert.equal(parsed.data.entries[0].nutrition, '深度知识');
  assert.equal(parsed.data.entries[0].minutes, 20);
  const noEntries = parseBackup(JSON.stringify({ app: 'c2c-003-information-recipe', kind: 'information-recipe-backup', data: {} }));
  assert.deepEqual(noEntries.data.entries, []);
  assert.equal(noEntries.data.dailyGoal, 150);
});
check('字段平铺在信封上的旧备份也能恢复', () => {
  const parsed = parseBackup(JSON.stringify({ app: 'c2c-003-information-recipe', kind: 'information-recipe-backup', dailyGoal: 90, entries: [] }));
  assert.equal(parsed.data.dailyGoal, 90);
});

// 5. 冲突检测与合并
const incoming: RecipeSnapshot = {
  dailyGoal: 999,
  entries: [
    { id: 'a', title: '深度好文', source: '文章', nutrition: '深度知识', minutes: 40, date: '2026-10-01', note: '' }, // id 重复
    { id: 'c', title: '播客一期', source: '播客', nutrition: '行业动态', minutes: 30, date: '2026-10-02', note: 'x' }, // 同内容指纹（id 不同）
    { id: 'd', title: '新内容', source: '书籍', nutrition: '娱乐消遣', minutes: 25, date: '2026-10-03', note: '' }, // 全新
  ],
};

check('能统计出 id 重复与内容重复', () => {
  assert.equal(countDuplicates(local.entries, incoming.entries), 2);
});
check('合并后重复记录只计一次，分钟数不翻倍', () => {
  const result = mergeSnapshots(local, incoming);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.snapshot.entries.length, 3);
  const minutes = result.snapshot.entries.reduce((s, e) => s + e.minutes, 0);
  assert.equal(minutes, 40 + 30 + 25); // 70 + 25，而不是 40+30+40+30+25
  assert.equal(result.snapshot.dailyGoal, 150); // 合并保留本地每日目标
});
check('无冲突时所有记录都新增，指纹函数稳定', () => {
  const fresh: RecipeSnapshot = { dailyGoal: 200, entries: [{ id: 'q', title: '全新', source: '视频', nutrition: '技能提升', minutes: 15, date: '2026-10-04', note: '' }] };
  assert.equal(countDuplicates(local.entries, fresh.entries), 0);
  const result = mergeSnapshots(local, fresh);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 0);
  assert.equal(entryFingerprint(result.snapshot.entries[0]), entryFingerprint(local.entries[0]));
});
check('种子数据导出再合并不产生重复', () => {
  const seed = sampleSnapshot();
  const roundTrip = parseBackup(JSON.stringify(createBackup(seed))).data;
  const result = mergeSnapshots(seed, roundTrip);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, seed.entries.length);
  assert.equal(result.snapshot.entries.length, seed.entries.length);
});

console.log(`\n全部 ${passed} 项检查通过`);
