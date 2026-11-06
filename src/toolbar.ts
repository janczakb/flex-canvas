import type {Annotation, AnnotationTool} from './types.js'

export type ToolGroup = 'drawing' | 'notes' | 'shapes' | 'text' | 'insert'
export type ToolProperty = 'color' | 'fill' | 'opacity' | 'stroke' | 'dash' | 'fontSize' | 'bold' | 'italic' | 'align' | 'noteIcon' | 'startCap' | 'endCap' | 'cloudIntensity' | 'eraserSize' | 'blendMode' | 'overlayText' | 'overlayColor' | 'repeatOverlayText' | 'fontFamily' | 'underline' | 'verticalAlign' | 'strokeColor'
export interface ToolDescriptor {readonly id: AnnotationTool; readonly group: ToolGroup; readonly properties: readonly ToolProperty[]}
export const annotationToolbarItems = ['pages', 'pager', 'viewMode', 'select', 'pan', 'zoom', 'zoomMode', 'search', 'edit-pages', 'annotations', 'print', 'download', 'undo', 'redo', 'delete'] as const
export type ToolbarItem = typeof annotationToolbarItems[number]
export interface ToolbarOptions {
    readonly compactBreakpoint?: number
    readonly narrowBreakpoint?: number
    readonly rememberTools?: boolean
    readonly items?: readonly ToolbarItem[]
    readonly tools?: readonly AnnotationTool[] | null
    readonly properties?: readonly ToolProperty[] | null
    /** Optional note/pin palette; every color must also be allowed in the document profile. */
    readonly noteColors?: readonly string[]
}

const descriptor = (id: AnnotationTool, group: ToolGroup, properties: readonly ToolProperty[]): ToolDescriptor => Object.freeze({id, group, properties: Object.freeze([...properties])})
export const annotationToolDescriptors: readonly ToolDescriptor[] = Object.freeze([
    descriptor('pen', 'drawing', ['color','fill','opacity','stroke','blendMode']),
    descriptor('highlight', 'drawing', ['color','fill','opacity','stroke','blendMode']),
    descriptor('text-highlight', 'drawing', ['color','opacity','blendMode']),
    descriptor('eraser', 'drawing', ['eraserSize']),
    descriptor('note', 'notes', ['color','noteIcon']),
    descriptor('pin', 'notes', ['color']),
    ...(['rectangle','ellipse','polygon'] as const).map(id => descriptor(id, 'shapes', ['color','fill','opacity','stroke','dash'])),
    descriptor('cloudy-polygon','shapes',['color','fill','opacity','stroke','cloudIntensity']),
    ...(['line','arrow','polyline'] as const).map(id => descriptor(id, 'shapes', ['color','fill','opacity','stroke','dash','startCap','endCap'])),
    descriptor('text', 'text', ['color','fill','opacity','fontFamily','fontSize','bold','italic','underline','align','verticalAlign']),
    descriptor('image','insert',['opacity']),
    descriptor('link','insert',[]),
    descriptor('signature','insert',['opacity']),
    descriptor('callout','text',['color','fill','strokeColor','opacity','stroke','fontFamily','fontSize','bold','italic','underline','align','verticalAlign']),
])

/** Group memory and responsive navigation are independent of any UI framework. */
export function createAnnotationToolbar(enabled: readonly AnnotationTool[], options: ToolbarOptions = {}) {
    const compactAt = options.compactBreakpoint ?? 1070, narrowAt = options.narrowBreakpoint ?? 768
    if (!Number.isFinite(compactAt) || !Number.isFinite(narrowAt) || narrowAt < 240 || compactAt <= narrowAt || compactAt > 4096) throw new RangeError('Invalid toolbar breakpoints')
    if (new Set(enabled).size !== enabled.length || enabled.some(id => id !== 'stamp' && !annotationToolDescriptors.some(item => item.id === id))) throw new TypeError('Invalid toolbar tools')
    const items = new Set(options.items ?? annotationToolbarItems)
    if ([...items].some(item => !annotationToolbarItems.includes(item))) throw new TypeError('Invalid viewer controls')
    const descriptors = annotationToolDescriptors.filter(item => enabled.includes(item.id) && (options.tools?.includes(item.id) ?? true))
    const memory = new Map<ToolGroup, AnnotationTool>()
    let width = Infinity, expanded = false, active: AnnotationTool | null = null, disposed = false
    const check = (): void => { if (disposed) throw new Error('Toolbar is disposed') }
    const members = (group: ToolGroup): readonly ToolDescriptor[] => descriptors.filter(item => item.group === group)
    const remembered = (group: ToolGroup): AnnotationTool | null => {
        const selected = descriptors.find(item => item.id === active && item.group === group)
        return selected?.id ?? memory.get(group) ?? members(group)[0]?.id ?? null
    }
    const state = () => Object.freeze({
        layout: width > compactAt ? 'wide' as const : width > narrowAt ? 'compact' as const : 'narrow' as const,
        expanded, active,
        groups: Object.freeze(Object.fromEntries((['drawing','notes','shapes','text','insert'] as const).map(group => [group, remembered(group)]))) as Readonly<Record<ToolGroup, AnnotationTool | null>>,
    })
    return Object.freeze({
        getState: () => {check(); return state()},
        resize(nextWidth: number) {check(); if (!Number.isFinite(nextWidth) || nextWidth < 0) throw new RangeError('Invalid toolbar width'); width = nextWidth; if (width > compactAt) expanded = false; return state()},
        expand(next = true) {check(); expanded = width <= compactAt && next; return state()},
        activate(id: AnnotationTool | null, {toggle = false}: {toggle?: boolean} = {}) {
            check()
            const item = id === null ? null : descriptors.find(item => item.id === id)
            if (id !== null && !item) throw new TypeError('Tool is disabled')
            active = toggle && active === id ? null : id
            if (item && options.rememberTools !== false) memory.set(item.group, item.id)
            return state()
        },
        selectGroup(group: ToolGroup) {check(); return remembered(group)},
        hasItem(item: ToolbarItem) {check(); return items.has(item)},
        getTools(group: ToolGroup) {check(); return Object.freeze(members(group))},
        supports(id: AnnotationTool | null, property: ToolProperty) {check(); return (options.properties?.includes(property) ?? true) && (descriptors.find(item => item.id === id)?.properties.includes(property) ?? false)},
        dispose() {disposed = true; memory.clear(); active = null},
    })
}
export type AnnotationToolbar = ReturnType<typeof createAnnotationToolbar>

export function annotationStyle(shape: Annotation) {
    return {...(['pen','highlight','text-highlight'].includes(shape.tool)?{blendMode:shape.blendMode??(shape.tool==='pen'?'normal':'multiply')}:{}),color:shape.color, stroke:shape.stroke, opacity:shape.opacity ?? 1, fill:shape.fill ?? 'none', dash:shape.dash ?? 'solid', fontFamily:shape.fontFamily??'Helvetica',verticalAlign:shape.verticalAlign??'top',underline:shape.underline??false,strokeColor:shape.strokeColor??shape.color,fontSize:shape.fontSize ?? 18, bold:shape.bold ?? false, italic:shape.italic ?? false, align:shape.align ?? 'left', ...(['line','arrow','polyline'].includes(shape.tool)?{startCap:shape.startCap??'none',endCap:shape.endCap??(shape.tool==='arrow'?'open-arrow':'none')}:{}), ...(shape.tool==='cloudy-polygon'?{cloudIntensity:shape.cloudIntensity??1}:{}), ...(shape.tool==='note'?{noteIcon:shape.noteIcon ?? 'comment'}:{})}
}

export function observeToolbarContainer(element: HTMLElement, update: (width: number) => void): () => void {
    let frame = 0, disposed = false
    const view = element.ownerDocument.defaultView
    if (!view) throw new Error('Toolbar has no document window')
    const schedule = (): void => {
        view.cancelAnimationFrame(frame)
        frame = view.requestAnimationFrame(() => { if (!disposed) update(element.getBoundingClientRect().width) })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(element); update(element.getBoundingClientRect().width)
    return () => {disposed = true; observer.disconnect(); view.cancelAnimationFrame(frame)}
}
