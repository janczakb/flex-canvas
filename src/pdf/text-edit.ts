export const pdfTextFamilies = ['sans', 'serif', 'mono'] as const
export type PDFTextFamily = typeof pdfTextFamilies[number]
export interface PDFTextAppearance {
    readonly family?: PDFTextFamily
    readonly size?: number
    readonly color?: string
    readonly bold?: boolean
    readonly italic?: boolean
}
export interface PDFTextBlock {
    readonly index: number
    readonly text: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
    readonly font: string
    readonly appearance: PDFTextAppearance
    readonly baseline?:number
    readonly rotation?:number
    readonly characters?:readonly PDFTextCharacter[]
}
export interface PDFTextCharacter {
    readonly start:number
    readonly end:number
    readonly x:number
    readonly y:number
    readonly width:number
    readonly height:number
    readonly endX:number
    readonly baseline:number
}
type TextReplacement = {readonly pageIndex:number; readonly index:number; readonly original:string}
export interface PDFTextFlow {
    readonly width:number
    readonly lineHeight:number
}
export type PDFTextEdit =
    | (TextReplacement & {readonly text:string; readonly appearance?:PDFTextAppearance})
    | (TextReplacement & {readonly remove:true})
    | {readonly pageIndex:number; readonly position:readonly [number,number]; readonly fontSource?:number; readonly text:string; readonly appearance?:PDFTextAppearance; readonly flow?:PDFTextFlow}

export function pdfStandardFont(family: PDFTextFamily, bold: boolean, italic: boolean): string {
    if(family==='serif')return bold?(italic?'Times-BoldItalic':'Times-Bold'):(italic?'Times-Italic':'Times-Roman')
    const base=family==='mono'?'Courier':'Helvetica'
    return base+(bold?(italic?'-BoldOblique':'-Bold'):(italic?'-Oblique':''))
}

export function validatePDFTextEdits(edits: readonly PDFTextEdit[], pageCount: number): void {
    if (!Array.isArray(edits) || !edits.length || edits.length > 100) throw new RangeError('Invalid text edit count')
    const seen = new Set<string>()
    for (const edit of edits) {
        if (!edit || !Number.isInteger(edit.pageIndex) || edit.pageIndex < 0 || edit.pageIndex >= pageCount) throw new RangeError('Invalid PDF text page')
        if ('position' in edit) {
            if (!Array.isArray(edit.position) || edit.position.length!==2 || edit.position.some((value:unknown)=>typeof value!=='number'||!Number.isFinite(value)||value<0||value>=1)) throw new RangeError('Invalid text position')
            if(edit.fontSource!==undefined&&(!Number.isSafeInteger(edit.fontSource)||edit.fontSource<0||edit.fontSource>=10000))throw new RangeError('Invalid text font source')
            if(edit.flow&&(!Number.isFinite(edit.flow.width)||edit.flow.width<=0||edit.flow.width>1-edit.position[0]+.00001
                ||!Number.isFinite(edit.flow.lineHeight)||edit.flow.lineHeight<=0||edit.flow.lineHeight>1))throw new RangeError('Invalid text flow')
        } else {
            const key = edit.pageIndex + ':' + edit.index
            if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= 10000 || seen.has(key) || typeof edit.original !== 'string' || edit.original.length > 512) throw new RangeError('Invalid PDF text object')
            seen.add(key)
        }
        if ('remove' in edit) {
            if(edit.remove!==true||!('index' in edit))throw new RangeError('Invalid text removal')
            continue
        }
        const flowing='position' in edit&&!!edit.flow
        if (typeof edit.text !== 'string' || !edit.text.trim() || edit.text.length > (flowing?8192:512)
            || (flowing?/[\u0000-\u0009\u000b-\u001f\u007f\p{Cs}]/u:/[\u0000-\u001f\u007f\p{Cs}]/u).test(edit.text)) throw new RangeError('Invalid replacement text')
        const style:PDFTextAppearance|undefined=edit.appearance
        if (style !== undefined && (!style || typeof style!=='object' || Array.isArray(style)
            || style.family !== undefined && !pdfTextFamilies.includes(style.family)
            || style.size !== undefined && (!Number.isFinite(style.size) || style.size < 1 || style.size > 144)
            || style.color !== undefined && (typeof style.color!=='string'||!/^#[0-9a-f]{6}$/i.test(style.color))
            || style.bold !== undefined && typeof style.bold!=='boolean'
            || style.italic !== undefined && typeof style.italic!=='boolean')) throw new RangeError('Invalid text appearance')
    }
}
