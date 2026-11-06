import type {PDFTextBlock,PDFTextEdit,PDFTextCharacter} from './text-edit.js'
import type {PDFCrop} from './crop.js'
import type {PDFRedaction} from './redactions.js'
import type { PDFPageEdit } from './page-plan.js'
import type { PageInfo } from './types.js'

export interface TextGlyph { index: number; text: string; x: number; y: number; width: number; height: number; fontSize: number; selection?: {x:number;y:number;width:number;height:number} }
export interface PageText { text: string; glyphs: TextGlyph[]; truncated: boolean }
export interface SearchHit { pageIndex: number; start: number; length: number; rectangles: Array<{x: number; y: number; width: number; height: number}> }
export interface OutlineItem { title: string; pageIndex: number | null; children: OutlineItem[] }
export interface PDFMetadata { title: string; author: string; subject: string; creator: string; producer: string; pageCount: number; permissions: number }
export interface PDFLink { x: number; y: number; width: number; height: number; pageIndex?: number; url?: string }
export interface Raster { width: number; height: number; rgba: ArrayBuffer }
export interface PDFTile {x: number; y: number; width: number; height: number; pageWidth: number; pageHeight: number}
export interface PDFTextFlowLayout {
    readonly fontSource?:number
    readonly position:readonly [number,number]
    readonly width:number
    readonly height:number
    readonly characters:PDFTextCharacter[]
}
export interface PDFTextPreview extends Raster {x:number;y:number;fractionWidth:number;fractionHeight:number;layouts:readonly PDFTextFlowLayout[]}
export interface PDFPageOverlay extends Raster { index: number }
export interface PDFMethods {
    prepare: { input: {wasmUrl:string}; output: true }
    open: { input: { bytes: ArrayBuffer; wasmUrl: string; password: string; maxPages: number }; output: {pageCount: number; canEditPages: boolean} }
    sizes: {input: Record<string,never>;output: Array<{width:number;height:number}>}
    info: { input: {index: number}; output: PageInfo }
    text: { input: {index: number; geometry: boolean}; output: PageText }
    render: { input: {index: number; width: number; height: number}; output: Raster }
    renderTile: { input: {index: number; tile: PDFTile}; output: Raster }
    search: { input: {index: number; query: string; matchCase: boolean; wholeWord: boolean; limit: number}; output: SearchHit[] }
    outline: { input: Record<string, never>; output: OutlineItem[] }
    metadata: { input: Record<string, never>; output: PDFMetadata }
    bytes: { input: Record<string, never>; output: ArrayBuffer }
    textBlocks: {input:{index:number};output:PDFTextBlock[]}
    previewText: {input:{index:number;edits:readonly PDFTextEdit[];width:number;height:number};output:PDFTextPreview}
    editText: {input:{edits:readonly PDFTextEdit[];maxBytes:number};output:ArrayBuffer}
    crop: {input:{crops:readonly PDFCrop[];maxBytes:number};output:ArrayBuffer}
    redact: {input:{redactions:readonly PDFRedaction[];maxBytes:number;font?:ArrayBuffer};output:ArrayBuffer}
    exportPDF: { input: { overlays: readonly PDFPageOverlay[]; maxBytes: number }; output: ArrayBuffer }
    editPages: { input: {pages: readonly PDFPageEdit[]; maxBytes: number}; output: ArrayBuffer }
    links: { input: {index: number}; output: PDFLink[] }
}
export type PDFMethod = keyof PDFMethods
export type PDFRequest = { [K in PDFMethod]: {id: number; method: K; input: PDFMethods[K]['input']} }[PDFMethod]
export type PDFResponse = {id: number; ok: true; value: unknown} | {id: number; ok: false; code: string}
