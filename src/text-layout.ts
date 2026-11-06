import type {Annotation} from './types.js'

export function annotationTextFont(shape:Annotation,scale=1):string {
    const family=shape.fontFamily??'Helvetica'
    const fallback=/Courier|mono/i.test(family)?'monospace':/Times|serif/i.test(family)?'serif':'sans-serif'
    return `${shape.italic?'italic ':''}${shape.bold?'700':'400'} ${(shape.fontSize??18)*scale}px "${family}",${fallback}`
}

/** Wraps text using the renderer's real font metrics without squeezing glyphs. */
export function wrapAnnotationText(context: Pick<CanvasRenderingContext2D,'measureText'>, text: string, width: number): readonly string[] {
    const lines: string[] = []
    for (const paragraph of text.split('\n')) {
        let line = ''
        for (const word of paragraph.split(/(\s+)/)) {
            if (!word) continue
            if (line && context.measureText(line + word).width > width) { lines.push(line.trimEnd()); line = '' }
            if (context.measureText(word).width <= width) { line += line ? word : word.trimStart(); continue }
            for (const character of word) {
                if (line && context.measureText(line + character).width > width) { lines.push(line); line = '' }
                line += character
            }
        }
        lines.push(line.trimEnd())
    }
    return lines
}
