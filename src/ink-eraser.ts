import {annotationStrokeWidth} from './stroke-width.js'
import type {Annotation, Point} from './types.js'

type Interval = readonly [number, number]
type Pixel = readonly [number, number]
const inkBounds = new WeakMap<Annotation,{left:number;top:number;right:number;bottom:number}>()
const clamp = (n: number) => Math.max(0, Math.min(1, n))

function circleInterval(p: Pixel, delta: Pixel, center: Pixel, radius: number): Interval | null {
    const dx = p[0] - center[0], dy = p[1] - center[1]
    const a = delta[0] ** 2 + delta[1] ** 2
    if (!a) return Math.hypot(dx, dy) <= radius ? [0, 1] : null
    const b = 2 * (dx * delta[0] + dy * delta[1]), c = dx ** 2 + dy ** 2 - radius ** 2
    const discriminant = b * b - 4 * a * c
    if (discriminant < 0) return null
    const first = (-b - Math.sqrt(discriminant)) / (2 * a), last = (-b + Math.sqrt(discriminant)) / (2 * a)
    return first <= 1 && last >= 0 ? [clamp(first), clamp(last)] : null
}

function linearInterval(start: number, delta: number, minimum: number, maximum: number): Interval | null {
    if (Math.abs(delta) < 1e-12) return start >= minimum && start <= maximum ? [0, 1] : null
    const a = (minimum - start) / delta, b = (maximum - start) / delta
    const first = Math.max(0, Math.min(a, b)), last = Math.min(1, Math.max(a, b))
    return first <= last ? [first, last] : null
}

/** Exact swept-circle intersections: no distance-dependent sampling or fast-pointer gaps. */
function capsuleIntervals(p: Pixel, end: Pixel, a: Pixel, b: Pixel, radius: number): Interval[] {
    if (Math.max(p[0], end[0]) < Math.min(a[0], b[0]) - radius || Math.min(p[0], end[0]) > Math.max(a[0], b[0]) + radius
        || Math.max(p[1], end[1]) < Math.min(a[1], b[1]) - radius || Math.min(p[1], end[1]) > Math.max(a[1], b[1]) + radius) return []
    const delta: Pixel = [end[0] - p[0], end[1] - p[1]]
    const intervals: Interval[] = []
    for (const center of [a, b]) { const interval = circleInterval(p, delta, center, radius); if (interval) intervals.push(interval) }
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!length) return intervals
    const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length
    const along = linearInterval((p[0] - a[0]) * ux + (p[1] - a[1]) * uy, delta[0] * ux + delta[1] * uy, 0, length)
    const across = linearInterval((p[0] - a[0]) * -uy + (p[1] - a[1]) * ux, delta[0] * -uy + delta[1] * ux, -radius, radius)
    if (along && across) {
        const first = Math.max(along[0], across[0]), last = Math.min(along[1], across[1])
        if (first <= last) intervals.push([first, last])
    }
    return intervals
}

/** Subtracts brush geometry from ink only. Text highlights and other shapes stay unchanged. */
export function eraseInk(shapes: readonly Annotation[], path: readonly Point[], width: number, height: number,
    {radius = 12, strokeScale = 1, mode = 'point', pageIndex = 0, maxShapes = 500, maxPoints = 512, createId = () => crypto.randomUUID()}:
    {radius?: number; strokeScale?: number; mode?: 'point' | 'stroke'; pageIndex?: number; maxShapes?: number; maxPoints?: number; createId?: () => string} = {}) {
    if (!path.length || !Number.isFinite(strokeScale) || strokeScale <= 0 || radius <= 0 || !Number.isFinite(radius) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {shapes, changed: false, limited: false}
    if (path.length > 4096 || maxPoints < 2 || path.some(point => point.length !== 2 || point.some(n => !Number.isFinite(n) || n < 0 || n > 1))) return {shapes, changed: false, limited: true}
    const pixels = path.map(([x, y]): Pixel => [x * width, y * height])
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity
    for(const [x,y] of pixels){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
    const next: Annotation[] = []
    let changed = false
    for (const shape of shapes) {
        if (!['pen', 'highlight'].includes(shape.tool) || (shape.pageIndex ?? 0) !== pageIndex) { next.push(shape); continue }
        let bounds=inkBounds.get(shape)
        if(!bounds){
            bounds={left:1,top:1,right:0,bottom:0}
            for(const [x,y] of shape.points){bounds.left=Math.min(bounds.left,x);bounds.top=Math.min(bounds.top,y);bounds.right=Math.max(bounds.right,x);bounds.bottom=Math.max(bounds.bottom,y)}
            inkBounds.set(shape,bounds)
        }
        const effectiveRadius = radius + annotationStrokeWidth(shape,strokeScale)/2
        if(bounds.right*width<left-effectiveRadius||bounds.left*width>right+effectiveRadius||bounds.bottom*height<top-effectiveRadius||bounds.top*height>bottom+effectiveRadius){next.push(shape);continue}
        const stroke = shape.points.map(([x, y]): Pixel => [x * width, y * height])
        const fragments: Point[][] = []
        let fragment: Point[] = [], hit = false
        const flush = () => { if (fragment.length >= 2) fragments.push(fragment); fragment = [] }
        for (let index = 1; index < stroke.length; index++) {
            const p = stroke[index - 1], end = stroke[index], intervals: Interval[] = []
            for (let step = 0; step < pixels.length; step++) intervals.push(...capsuleIntervals(p, end, pixels[Math.max(0, step - 1)], pixels[step], effectiveRadius))
            intervals.sort((a, b) => a[0] - b[0])
            const erased: number[][] = []
            for (const interval of intervals) {
                const last = erased.at(-1)
                if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1])
                else erased.push([...interval])
            }
            const at = (t: number): Point => [clamp((p[0] + (end[0] - p[0]) * t) / width), clamp((p[1] + (end[1] - p[1]) * t) / height)]
            if (erased.length) hit = true
            if (hit && mode === 'stroke') break
            let cursor = 0
            for (const [start, finish] of erased) {
                if (start > cursor) { if (!fragment.length) fragment.push(at(cursor)); fragment.push(at(start)) }
                flush(); cursor = Math.max(cursor, finish)
            }
            if (cursor < 1) { if (!fragment.length) fragment.push(at(cursor)); fragment.push(at(1)) }
        }
        if (!hit) { next.push(shape); continue }
        changed = true
        if (mode === 'stroke') continue
        flush()
        for (const [index, points] of fragments.entries()) {
            const bounded = points.length <= maxPoints ? points : Array.from({length: maxPoints}, (_, i) => points[Math.round(i * (points.length - 1) / (maxPoints - 1))])
            next.push({...shape, id: index === 0 ? shape.id : createId(), points: bounded})
        }
        if (next.length > maxShapes) return {shapes, changed: false, limited: true}
    }
    if (next.length > maxShapes) return {shapes, changed: false, limited: true}
    return {shapes: changed ? next : shapes, changed, limited: false}
}
