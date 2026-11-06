import type {PDFCropBox} from './pdf/crop.js'

export function createCropSelection(viewport: HTMLElement, signal: AbortSignal, options: {
    active: () => boolean
    pickPage: (element: Element) => {index:number; stage: HTMLElement} | undefined
    change: (selection?: {index: number; box: PDFCropBox}) => void
}) {
    const outline = viewport.ownerDocument.createElement('div')
    outline.className = 'fm-crop-selection'
    outline.setAttribute('aria-hidden', 'true')
    let drag: {id: number; index: number; stage: HTMLElement; x: number; y: number} | undefined

    function point(event: PointerEvent, stage: HTMLElement): [number, number] {
        const rect = stage.getBoundingClientRect()
        const clamp = (n: number) => Math.min(1, Math.max(0, n))
        return [clamp((event.clientX-rect.left)/rect.width), clamp((event.clientY-rect.top)/rect.height)]
    }

    function draw(event: PointerEvent): PDFCropBox | undefined {
        if (!drag || drag.id !== event.pointerId) return
        const [u,v] = point(event, drag.stage)
        const box = [Math.min(drag.x,u), Math.min(drag.y,v), Math.abs(u-drag.x), Math.abs(v-drag.y)] as const
        const [x,y,w,h] = box
        outline.style.cssText = 'left:'+x*100+'%;top:'+y*100+'%;width:'+w*100+'%;height:'+h*100+'%'
        return box
    }

    function clear() {
        if (drag && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id)
        drag = undefined
        outline.remove()
    }

    viewport.addEventListener('pointerdown', event => {
        if (!options.active() || event.button !== 0 || !(event.target instanceof Element)) return
        const page = options.pickPage(event.target)
        if (!page) return
        event.preventDefault()
        event.stopImmediatePropagation()
        clear()
        const [x,y] = point(event, page.stage)
        drag = {...page, id: event.pointerId, x, y}
        page.stage.append(outline)
        draw(event)
        options.change()
        viewport.setPointerCapture(event.pointerId)
    }, {capture:true,signal})
    viewport.addEventListener('pointermove', event => {draw(event)}, {signal})
    viewport.addEventListener('pointerup', event => {
        const box = draw(event)
        if (!box || !drag) return
        const {index} = drag
        drag = undefined
        if (box[2] >= .005 && box[3] >= .005) options.change({index,box})
        else clear()
    }, {signal})
    viewport.addEventListener('pointercancel', () => {clear();options.change()}, {signal})
    signal.addEventListener('abort', clear, {once:true})
    return {clear}
}
