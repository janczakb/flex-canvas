import type {Annotation} from './types.js'

/** Converts a stored document width into CSS pixels at the current page scale. */
export function annotationStrokeWidth(shape: Pick<Annotation, 'tool' | 'stroke' | 'blendMode'>, scale = 1): number {
    const legacyMultiplier = shape.tool === 'highlight' && !shape.blendMode ? 3 : 1
    return shape.stroke * legacyMultiplier * scale
}
