# c2c-003 · 信息食谱调配师

Vue 3 + TypeScript + Vite 纯前端信息摄入管理工具。用户记录文章、视频、播客、社交媒体和书籍等信息消费，按深度知识、行业动态、技能提升、娱乐消遣、社交信息分类，通过营养金字塔、偏食检测、优化食谱与摄入报告管理信息饮食。数据保存在浏览器 `localStorage`。

## 分层

- 核心层 `src/core`：摄入记录、营养比例、偏食/缺失检测、餐盘评分与食谱建议
- 端口层 `src/ports`：信息食谱快照仓储接口
- 适配器层 `src/adapters`：浏览器本地存储实现
- 界面层 `src/ui`：Vue 页面与原生 CSS 视图

## 命令

```bash
npm install
npm run dev
npm run build
docker compose up --build
```

访问 `http://localhost:8103`。
