export class PDFEngineError extends Error {
    constructor(public readonly code: string, message: string) { super(message); this.name = 'PDFEngineError' }
}
export interface PDFLimits {
    readonly maxBytes: number
    readonly maxDepth: number
    readonly maxTokens: number
    readonly maxStringBytes: number
    readonly maxArrayItems: number
}
export const defaultPDFLimits: PDFLimits = Object.freeze({ maxBytes: 104857600, maxDepth: 64, maxTokens: 1000000, maxStringBytes: 1048576, maxArrayItems: 100000 })
export interface PDFName { readonly kind: 'name'; readonly value: string }
export interface PDFString { readonly kind: 'string'; readonly bytes: Uint8Array }
export interface PDFReference { readonly kind: 'reference'; readonly object: number; readonly generation: number }
export type PDFValue = number | boolean | null | PDFName | PDFString | PDFReference | readonly PDFValue[] | PDFDictionary
export interface PDFDictionary { readonly kind: 'dictionary'; readonly entries: ReadonlyMap<string, PDFValue> }
export interface PageInfo { readonly pageIndex: number; readonly width: number; readonly height: number; readonly rotation: number }
export interface PageRender { readonly pageIndex: number; readonly width: number; readonly height: number; readonly pixelWidth: number; readonly pixelHeight: number }
export type PDFRenderPriority = 'foreground' | 'background'
export interface RenderOptions { priority?: PDFRenderPriority; scale?: number; pixelRatio?: number; signal?: AbortSignal }
