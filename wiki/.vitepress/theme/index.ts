import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import DiagramViewer from './DiagramViewer.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'layout-bottom': () => h(DiagramViewer),
  }),
}
