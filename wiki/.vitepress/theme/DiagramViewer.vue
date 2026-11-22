<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vitepress'
import mediumZoom from 'medium-zoom'

const route = useRoute()
const dialog = ref<HTMLDialogElement>()
const image = ref('')
const baseWidth = ref(0)
const scale = ref(1)
let pageObserver: MutationObserver | undefined
let images: ReturnType<typeof mediumZoom> | undefined

function openDiagram(svg: SVGSVGElement) {
  const documentSvg = svg.cloneNode(true) as SVGSVGElement
  const width = svg.viewBox.baseVal.width || svg.getBoundingClientRect().width
  documentSvg.style.removeProperty('max-width')
  documentSvg.removeAttribute('width')
  documentSvg.removeAttribute('height')
  baseWidth.value = Math.min(width, window.innerWidth * 0.8)
  image.value = 'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(new XMLSerializer().serializeToString(documentSvg))
  scale.value = 1
  dialog.value?.showModal()
}

function addDiagramControls() {
  for (const diagram of document.querySelectorAll<HTMLElement>('.vp-doc .mermaid')) {
    const svg = diagram.querySelector('svg')
    if (!svg || diagram.nextElementSibling?.classList.contains('diagram-open')) continue

    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = '放大图表'
    button.className = 'diagram-open'
    const show = () => {
      const currentSvg = diagram.querySelector('svg')
      if (currentSvg) openDiagram(currentSvg)
    }
    button.addEventListener('click', show)
    diagram.addEventListener('click', show)
    diagram.after(button)
  }
}

function attachImages() {
  images?.detach()
  images?.attach('.vp-doc img:not(.no-zoom)')
}

onMounted(() => {
  images = mediumZoom({ background: 'var(--vp-c-bg-elv)' })
  attachImages()
  addDiagramControls()
  pageObserver = new MutationObserver(addDiagramControls)
  pageObserver.observe(document.querySelector('#app') ?? document.body, {
    childList: true,
    subtree: true,
  })
})

watch(() => route.path, () => {
  dialog.value?.close()
  attachImages()
}, { flush: 'post' })

onUnmounted(() => {
  pageObserver?.disconnect()
  images?.detach()
})
</script>

<template>
  <dialog ref="dialog" class="diagram-dialog" aria-label="图表预览" @close="image = ''">
    <div class="diagram-controls">
      <button type="button" :disabled="scale <= 0.5" @click="scale -= 0.25">缩小</button>
      <span aria-live="polite">{{ Math.round(scale * 100) }}%</span>
      <button type="button" :disabled="scale >= 3" @click="scale += 0.25">放大</button>
      <button type="button" autofocus @click="dialog?.close()">关闭</button>
    </div>
    <div class="diagram-canvas" tabindex="0" aria-label="图表区域，可滚动查看">
      <img v-if="image" :src="image" :style="{ width: (baseWidth * scale) + 'px' }" alt="当前文档的放大图表">
    </div>
  </dialog>
</template>
