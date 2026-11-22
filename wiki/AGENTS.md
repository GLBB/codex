# Codex 源码 Wiki

## 构建和本地运行

从仓库根目录运行：

- `npm --prefix wiki ci`
- `npm --prefix wiki run dev`
- `npm --prefix wiki run build`
- `npm --prefix wiki run preview`

## 文档结构

- `index.md` 提供快速开始、文档地图和源码入口。
- `catalogue.json` 驱动侧栏，记录当前源码提交。
- `onboarding/`、`getting-started/`、`architecture/`、`protocols/`、`deep-dive/` 存放文档正文。
- `llms.txt` 与 `llms-full.txt` 提供站点索引和全文。仓库根目录的 `llms.txt` 使用带 `wiki/` 的相对路径。

## 更新和验证

内部链接使用相对 Markdown 路径。每页包含 `title` 和 `description` 头部。源码链接固定到已核对的提交和行号。Mermaid 图后记录源码位置，时序图使用 `autonumber`。发布前构建站点，预览图表和目录，并核对站点索引及全文与当前页面一致。
