export type SourceType = '文章' | '视频' | '播客' | '社交媒体' | '书籍';
export type NutritionType = '深度知识' | '行业动态' | '技能提升' | '娱乐消遣' | '社交信息';
export interface InfoEntry { id: string; title: string; source: SourceType; nutrition: NutritionType; minutes: number; date: string; note: string; }
export interface RecipeSnapshot { entries: InfoEntry[]; dailyGoal: number; }
export interface NutritionMetric { nutrition: NutritionType; minutes: number; share: number; target: number; color: string; icon: string; }
export const SOURCES: SourceType[] = ['文章', '视频', '播客', '社交媒体', '书籍'];
export const NUTRITION: NutritionType[] = ['深度知识', '行业动态', '技能提升', '娱乐消遣', '社交信息'];
export const NUTRITION_META: Record<NutritionType, { color: string; icon: string; target: number; hint: string }> = {
  深度知识: { color: '#e39c57', icon: '▰', target: 0.3, hint: '需要完整注意力的长内容' },
  行业动态: { color: '#5ca8b8', icon: '◌', target: 0.2, hint: '保持与世界同步' },
  技能提升: { color: '#8b91d1', icon: '↗', target: 0.2, hint: '可迁移的实践能力' },
  娱乐消遣: { color: '#d77484', icon: '✦', target: 0.15, hint: '有意识的放松' },
  社交信息: { color: '#72b47b', icon: '◎', target: 0.15, hint: '连接人与人的信息' },
};
