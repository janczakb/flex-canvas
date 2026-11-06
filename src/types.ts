export const tools = ['arrow', 'line', 'rectangle', 'ellipse', 'pen', 'highlight', 'text-highlight', 'eraser', 'text', 'callout', 'pin', 'note', 'stamp', 'image', 'link', 'signature', 'polygon', 'cloudy-polygon', 'polyline'] as const
export type AnnotationTool = typeof tools[number]
export type Point = readonly [number, number]
export const noteIcons = ['comment','pointer','arrow','check','circle','cross','insert','new-paragraph','note','paragraph','help','star','key'] as const
export type NoteIcon = typeof noteIcons[number]
export const lineEndings = ['none','square','circle','diamond','open-arrow','closed-arrow','bar','reverse-open-arrow','reverse-closed-arrow','slash'] as const
export type LineEnding = typeof lineEndings[number]
export const annotationBlendModes=['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'] as const
export type AnnotationBlendMode=typeof annotationBlendModes[number]
export const textMarkupActions=['highlight','strikeout','underline','squiggle','comment','redaction'] as const
export type TextMarkup='highlight'|'strikeout'|'underline'|'squiggle'|'redaction'
export interface Annotation {
    readonly id: string
    readonly tool: Exclude<AnnotationTool,'eraser'>
    readonly color: string
    readonly stroke: number
    readonly points: readonly Point[]
    readonly text?: string
    readonly asset?: string
    readonly href?: string
    readonly targetPage?: number
    readonly blendMode?: AnnotationBlendMode
    readonly overlayText?: string
    readonly overlayColor?: string
    readonly repeatOverlayText?: boolean
    readonly markup?: TextMarkup
    readonly rectangles?: readonly (readonly [number,number,number,number])[]
    readonly opacity?: number
    readonly fill?: string
    readonly dash?: 'solid' | 'dashed' | 'dotted'
    readonly fontSize?: number
    readonly bold?: boolean
    readonly italic?: boolean
    readonly underline?:boolean
    readonly fontFamily?:string
    readonly verticalAlign?:'top'|'center'|'bottom'
    readonly strokeColor?:string
    readonly align?: 'left' | 'center' | 'right'
    readonly pageIndex?: number
    readonly noteIcon?: NoteIcon
    readonly cloudIntensity?: number
    readonly startCap?: LineEnding
    readonly endCap?: LineEnding
}
export interface AnnotationProfile {
    readonly tools: readonly AnnotationTool[]
    readonly colors: readonly string[]
    readonly minStroke: number
    readonly maxStroke: number
    readonly maxShapes: number
    readonly maxPages: number
    readonly maxPoints: number
    readonly maxTextBytes: number
    readonly maxLayerBytes: number
    readonly readOnly: boolean
    readonly noteIcons: readonly NoteIcon[]
    readonly textMarkupActions: readonly (typeof textMarkupActions[number])[]
    readonly blendModes: readonly AnnotationBlendMode[]
    readonly eraserMode: 'point' | 'stroke'
    readonly eraserSize: number
    readonly lineEndings: readonly LineEnding[]
    readonly textFonts:readonly string[]
}
export type ProfileOptions = Partial<AnnotationProfile>
export type AnnotationCommand =
    | { readonly type: 'add'; readonly shape: Annotation }
    | { readonly type: 'update'; readonly id: string; readonly patch: Partial<Omit<Annotation, 'id'>> }
    | { readonly type: 'remove'; readonly id: string }
    | { readonly type: 'replace'; readonly shapes: readonly Annotation[] }
    | { readonly type: 'clear' | 'undo' | 'redo' }
export interface DocumentState {
    readonly shapes: readonly Annotation[]
    readonly dirty: boolean
    readonly canUndo: boolean
    readonly canRedo: boolean
    readonly sequence: number
}
export interface DocumentEvent extends DocumentState {
    readonly type: 'change'
    readonly command: AnnotationCommand['type'] | 'saved' | 'import'
}
export interface AnnotationDocument {
    getState(): DocumentState
    subscribe(listener: (event: DocumentEvent) => void): () => void
    dispatch(command: AnnotationCommand): DocumentState
    markSaved(snapshot?: readonly Annotation[]): DocumentState
    export(): string
    import(payload: string): DocumentState
    dispose(): void
}
export class AnnotationError extends Error {
    constructor(public readonly code: string) { super(code); this.name = 'AnnotationError' }
}
