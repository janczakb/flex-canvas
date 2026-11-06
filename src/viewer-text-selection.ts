type Rect = [number, number, number, number]

export function readTextSelection(layer: HTMLElement, selection: Selection | null, limit = 512): Rect[] {
    if (!selection || !selection.rangeCount) return []
    const root = layer.getRootNode()
    const composed = selection as Selection & { getComposedRanges?(options: { shadowRoots: ShadowRoot[] }): StaticRange[] }
    const range = root instanceof ShadowRoot && typeof composed.getComposedRanges === 'function'
        ? composed.getComposedRanges({ shadowRoots: [root] })[0]
        : selection.getRangeAt(0)
    if (!range || range.startContainer===range.endContainer && range.startOffset===range.endOffset) return []
    const content = layer.ownerDocument.createRange()
    content.setStart(range.startContainer, range.startOffset)
    content.setEnd(range.endContainer, range.endOffset)
    if (!content.intersectsNode(layer)) return []
    const lines = new Map<string, Rect>()
    for (const span of layer.querySelectorAll<HTMLElement>('[data-fff-text-box]')) {
        if (!content.intersectsNode(span)) continue
        const node = span.firstChild
        if (!node || (content.startContainer === node && content.startOffset >= (node.textContent?.length ?? 0))
            || (content.endContainer === node && content.endOffset === 0)) continue
        const [x, y, width, height] = JSON.parse(span.dataset.fffTextBox!) as Rect
        const key = span.dataset.fffTextLine!
        const previous = lines.get(key)
        if (previous) {
            const left = Math.min(previous[0], x)
            previous[2] = Math.max(previous[0] + previous[2], x + width) - left
            previous[0] = left
        } else {
            lines.set(key, [x, y, width, height])
            if (lines.size > limit) return []
        }
    }
    return [...lines.values()]
}
