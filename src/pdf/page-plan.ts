export type PDFPageEdit =
    | { index: number; rotation: number }
    | { width: number; height: number; rotation: number }

export function validatePagePlan(pages: readonly PDFPageEdit[], sourcePages: number, maxPages: number): void {
    if (!Array.isArray(pages) || pages.length < 1 || pages.length > maxPages) throw new RangeError('Invalid output page count')
    for (const page of pages) {
        if (!page || ![0, 1, 2, 3].includes(page.rotation)) throw new RangeError('Invalid page rotation')
        if ('index' in page) {
            if (!Number.isSafeInteger(page.index) || page.index < 0 || page.index >= sourcePages) throw new RangeError('Invalid source page')
        } else if (![page.width, page.height].every(size => Number.isFinite(size) && size >= 1 && size <= 14400)) {
            throw new RangeError('Invalid blank page size')
        }
    }
}

import type { Annotation, Point } from '../types.js'

/** Maps the independent annotation layer onto a newly written page tree. */
export function remapPageAnnotations(shapes: readonly Annotation[], pages: readonly PDFPageEdit[]): readonly Annotation[] {
    const destinations = new Map<number, Array<{page: number; rotation: number}>>()
    pages.forEach((entry, page) => {
        if (!('index' in entry)) return
        if (!destinations.has(entry.index)) destinations.set(entry.index, [])
        destinations.get(entry.index)!.push({page, rotation: entry.rotation})
    })
    const rotate = ([x,y]: Point, turns: number): Point => {
        if (turns === 1) return [1-y,x]
        if (turns === 2) return [1-x,1-y]
        if (turns === 3) return [y,1-x]
        return [x,y]
    }
    return shapes.flatMap(shape => (destinations.get(shape.pageIndex ?? 0) ?? []).flatMap(({page, rotation}, copy): Annotation[] => {
        const targetPage = shape.targetPage === undefined ? undefined : destinations.get(shape.targetPage)?.[0]?.page
        if (shape.targetPage !== undefined && targetPage === undefined) return []
        const points = shape.points.map(point => rotate(point, rotation))
        if (rotation && points.length >= 2 && ['rectangle','ellipse','text','callout','image','link','signature'].includes(shape.tool)) {
            const [a,b] = points
            points[0] = [Math.min(a[0],b[0]),Math.min(a[1],b[1])]
            points[1] = [Math.max(a[0],b[0]),Math.max(a[1],b[1])]
        }
        const rectangles = shape.rectangles?.map(([x,y,w,h]) => {
            const a = rotate([x,y],rotation), b = rotate([x+w,y+h],rotation)
            return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])] as const
        })
        return [{...shape, id:copy ? crypto.randomUUID() : shape.id, pageIndex:page, points,
            ...(rectangles ? {rectangles} : {}), ...(targetPage === undefined ? {} : {targetPage})}]
    }))
}
