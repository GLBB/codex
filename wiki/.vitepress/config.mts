import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import catalogue from '../catalogue.json'

const pages = ['index.md', ...catalogue.items.flatMap(({ children }) =>
  children.map(({ name }) => name + '.md'),
)]

export default withMermaid(defineConfig({
  lang: 'zh-CN',
  title: catalogue.title,
  description: '从源码理解 Codex 的 Agent Loop、客户端协议、状态、工具和轨迹',
  appearance: false,
  cleanUrls: true,
  srcExclude: ['AGENTS.md', 'CLAUDE.md'],
  themeConfig: {
    nav: [
      { text: '角色指南', link: '/onboarding/' },
      { text: '本地运行', link: '/getting-started/run-locally' },
      { text: 'Agent Loop', link: '/architecture/agent-loop' },
      { text: '协议设计', link: '/protocols/' },
    ],
    sidebar: catalogue.items.map(({ title, children }) => ({
      text: title,
      collapsed: false,
      items: children.map(({ title, name }) => ({
        text: title,
        link: '/' + name.replace(/\/index$/, '/'),
      })),
    })),
    search: {
      provider: 'local',
      options: { locales: { root: { translations: {
        button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
        modal: { noResultsText: '没有匹配的文档', resetButtonTitle: '清空搜索',
          footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } },
      } } } },
    },
    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一篇', next: '下一篇' },
    sidebarMenuLabel: '文档目录',
    returnToTopLabel: '返回顶部',
  },
  mermaid: {
    theme: 'base',
    securityLevel: 'strict',
    flowchart: { htmlLabels: false },
    themeVariables: {
      background: '#fffdf8',
      primaryColor: '#e8f0ec',
      primaryTextColor: '#302d28',
      primaryBorderColor: '#628077',
      secondaryColor: '#f3ebdd',
      secondaryTextColor: '#302d28',
      tertiaryColor: '#f6f2ea',
      tertiaryTextColor: '#302d28',
      tertiaryBorderColor: '#a49987',
      lineColor: '#556962',
      signalColor: '#556962',
      sequenceNumberColor: '#ffffff',
      edgeLabelBackground: '#fffdf8',
      noteBkgColor: '#f3ebdd',
    },
  },
  mermaidPlugin: { class: 'mermaid' },
  async buildEnd({ root, outDir }) {
    await Promise.all(['llms.txt', 'llms-full.txt', ...pages].map(async name => {
      const destination = resolve(outDir, name)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(resolve(root, name), destination)
    }))
  },
}))
