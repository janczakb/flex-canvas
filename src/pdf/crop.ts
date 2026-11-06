import {annotationBounds} from '../canvas.js'
import type {Annotation, Point} from '../types.js'

export type PDFCropBox = readonly [left: number, top: number, width: number, height: number]
export interface PDFCrop {readonly pageIndex: number; readonly box: PDFCropBox}

export function validatePDFCrops(crops: readonly PDFCrop[], pageCount: number): void {
    if (!Array.isArray(crops) || !crops.length || crops.length > pageCount) throw new RangeError('Invalid PDF crop count')
    const seen = new Set<number>()
    for (const crop of crops) {
        if (!crop || !Number.isInteger(crop.pageIndex) || crop.pageIndex < 0 || crop.pageIndex >= pageCount || seen.has(crop.pageIndex)) throw new RangeError('Invalid PDF crop page')
        if (!Array.isArray(crop.box) || crop.box.length !== 4 || crop.box.some((value:unknown) => typeof value!=='number' || !Number.isFinite(value) || value < 0 || value > 1)) throw new RangeError('Invalid PDF crop box')
        const [x,y,w,h] = crop.box
        if (w < .005 || h < .005 || x+w > 1.000001 || y+h > 1.000001) throw new RangeError('Invalid PDF crop bounds')
        seen.add(crop.pageIndex)
    }
}

export function remapCropAnnotations(shapes: readonly Annotation[], crops: readonly PDFCrop[]): readonly Annotation[] {
    const boxes = new Map(crops.map(crop => [crop.pageIndex, crop.box]))
    return shapes.map(shape => {
        const box = boxes.get(shape.pageIndex ?? 0)
        if (!box) return shape
        const [x,y,w,h] = box
        const bounds = annotationBounds(shape)
        if (bounds.left < x || bounds.top < y || bounds.right > x+w || bounds.bottom > y+h) throw new RangeError('Crop intersects an annotation')
        const convert = ([u,v]: Point): Point => [Math.min(1, (u-x)/w), Math.min(1, (v-y)/h)]
        const rectangles = shape.rectangles?.map(([u,v,width,height]) => [...convert([u,v]), width/w, height/h] as const)
        return {...shape, points: shape.points.map(convert), ...(rectangles ? {rectangles} : {})}
    })
}
