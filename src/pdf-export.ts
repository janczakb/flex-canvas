import { paintAnnotation } from './canvas.js'
import type { IndependentPDFDocument } from './pdf.js'
import type { PDFPageOverlay } from './pdf/protocol.js'
import type { Annotation } from './types.js'

export async function exportAnnotatedPDF(pdf: IndependentPDFDocument, shapes: readonly Annotation[], owner: Document): Promise<ArrayBuffer> {
    const layers = new Map<number, Annotation[]>()
    for (const shape of shapes) {
        const index = shape.pageIndex ?? 0
        if (!layers.has(index)) layers.set(index, [])
        layers.get(index)!.push(shape)
    }
    const overlays: PDFPageOverlay[] = []
    const canvas = owner.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    const budget = 8388608 / Math.max(layers.size, 1)
    try {
        for (const [index, layer] of layers) {
            const page = await pdf.getPageInfo(index)
            const scale = Math.min(2, 1280 / Math.max(page.width, page.height), Math.sqrt(budget / (page.width * page.height)))
            canvas.width = Math.max(1, Math.floor(page.width * scale))
            canvas.height = Math.max(1, Math.floor(page.height * scale))
            let pin = 0
            for (const shape of layer) {
                if (shape.tool === 'pin') pin++
                const image = shape.asset ? owner.createElement('img') : undefined
                if (image) { image.src = shape.asset!; await image.decode() }
                paintAnnotation(context, shape, canvas.width, canvas.height, pin, false, scale, image)
            }
            overlays.push({index, width: canvas.width, height: canvas.height, rgba: context.getImageData(0, 0, canvas.width, canvas.height).data.buffer as ArrayBuffer})
        }
        return await pdf.exportPDF(overlays)
    } finally { canvas.width = canvas.height = 1 }
}

export function downloadMediaBlob(owner: Document, data: Blob, filename: string): void {
    const url = URL.createObjectURL(data)
    const link = owner.createElement('a')
    link.href = url; link.download = filename; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
