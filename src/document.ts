import { textMarkupActions, annotationBlendModes, tools, noteIcons, lineEndings, AnnotationError, type Annotation, type AnnotationCommand, type AnnotationDocument, type AnnotationProfile, type DocumentEvent, type DocumentState, type Point, type ProfileOptions } from './types.js'
export const annotationSDKVersion = 1 as const
export const annotationTools = tools
const bytes = (value: string): number => new TextEncoder().encode(value).length
function fail(code = 'annotation_geometry_invalid'): never { throw new AnnotationError(code) }
const keys = new Set(['asset', 'href', 'targetPage', 'id', 'tool', 'color', 'stroke', 'points', 'text', 'opacity', 'fill', 'dash', 'pageIndex', 'fontSize', 'bold', 'italic', 'align', 'noteIcon', 'startCap', 'endCap', 'cloudIntensity', 'rectangles','blendMode','markup','overlayText','overlayColor','repeatOverlayText','underline','fontFamily','verticalAlign','strokeColor'])
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
const bounded = (value: number, min: number, max: number): boolean => Number.isInteger(value) && value >= min && value <= max

export function createAnnotationProfile(options: ProfileOptions = {}): AnnotationProfile {
    const profile: AnnotationProfile = { tools, noteIcons, lineEndings, textFonts:['Helvetica','Times New Roman','Courier New'], blendModes:annotationBlendModes, textMarkupActions, colors: ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#171717', '#ffffff', '#fff176'], minStroke: 1, maxStroke: 40, maxShapes: 500, maxPages: 1, maxPoints: 512, maxTextBytes: 512, maxLayerBytes: 262144, readOnly: false, eraserMode: 'point', eraserSize: 24, ...options }
    if (!Array.isArray(profile.textFonts)||!profile.textFonts.length||profile.textFonts.length>32||profile.textFonts.some(font=>typeof font!=='string'||font.length>64||!/^[\p{L}\p{N} _-]+$/u.test(font))||new Set(profile.textFonts).size!==profile.textFonts.length
        || !Array.isArray(profile.textMarkupActions)||profile.textMarkupActions.some(action=>!textMarkupActions.includes(action))||new Set(profile.textMarkupActions).size!==profile.textMarkupActions.length
        || !Array.isArray(profile.blendModes)||!profile.blendModes.length||profile.blendModes.some(mode=>!annotationBlendModes.includes(mode))||new Set(profile.blendModes).size!==profile.blendModes.length
        || !['point','stroke'].includes(profile.eraserMode) || !bounded(profile.eraserSize,4,128)
        || !Array.isArray(profile.lineEndings) || !profile.lineEndings.length || profile.lineEndings.length > lineEndings.length || profile.lineEndings.some(cap=>!lineEndings.includes(cap)) || new Set(profile.lineEndings).size !== profile.lineEndings.length
        || !Array.isArray(profile.noteIcons) || !profile.noteIcons.length || profile.noteIcons.length > noteIcons.length || profile.noteIcons.some(icon=>!noteIcons.includes(icon)) || new Set(profile.noteIcons).size !== profile.noteIcons.length
        || !Array.isArray(profile.tools) || profile.tools.length < 1 || profile.tools.some(tool => !tools.includes(tool)) || new Set(profile.tools).size !== profile.tools.length
        || !Array.isArray(profile.colors) || profile.colors.length < 1 || profile.colors.length > 32 || profile.colors.some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/.test(color)) || new Set(profile.colors).size !== profile.colors.length
        || !bounded(profile.minStroke, 1, 64) || !bounded(profile.maxStroke, profile.minStroke, 64) || !bounded(profile.maxShapes, 1, 2000)
        || !bounded(profile.maxPages, 1, 10000) || !bounded(profile.maxPoints, 2, 4096) || !bounded(profile.maxTextBytes, 1, 4096)
        || !bounded(profile.maxLayerBytes, 1024, 1048576) || typeof profile.readOnly !== 'boolean') fail('annotation_profile_invalid')
    return Object.freeze({ ...profile, textFonts:Object.freeze([...profile.textFonts]), blendModes:Object.freeze([...profile.blendModes]), textMarkupActions:Object.freeze([...profile.textMarkupActions]), lineEndings: Object.freeze([...profile.lineEndings]), tools: Object.freeze([...profile.tools]), noteIcons: Object.freeze([...profile.noteIcons]), colors: Object.freeze([...profile.colors]) })
}

/** Canonical, bounded data. No source-image bytes or executable content are part of a layer. */
export function normalizeAnnotations(input: unknown, configuration: ProfileOptions = {}): readonly Annotation[] {
    const profile = createAnnotationProfile(configuration)
    if (!Array.isArray(input) || input.length > profile.maxShapes) fail('annotation_layer_limit')
    const ids = new Set<string>()
    const shapes = input.map((value: unknown): Annotation => {
        if (!record(value) || Object.keys(value).some(key => !keys.has(key))
            || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id) || ids.has(value.id)
            || !profile.tools.includes(value.tool as Annotation['tool']) || typeof value.color !== 'string' || !profile.colors.includes(value.color)
            || typeof value.stroke !== 'number' || !bounded(value.stroke, profile.minStroke, profile.maxStroke)) return fail()
        ids.add(value.id)
        if(value.tool==='eraser')return fail()
        const tool = value.tool as Annotation['tool']
        const minimum = tool === 'callout' ? 4 : ['pin', 'text', 'note', 'stamp'].includes(tool) ? 1 : ['polygon','cloudy-polygon'].includes(tool) ? 3 : 2
        const maximum = ['pen', 'highlight', 'polygon', 'cloudy-polygon', 'polyline'].includes(tool) ? profile.maxPoints : tool==='text'?2:minimum
        if (!Array.isArray(value.points) || value.points.length < minimum || value.points.length > maximum) return fail()
        const points = value.points.map((point: unknown): Point => {
            if (!Array.isArray(point) || point.length !== 2 || point.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) return fail()
            return Object.freeze([Math.round((point[0] as number) * 1e6) / 1e6, Math.round((point[1] as number) * 1e6) / 1e6])
        })
        const result: { -readonly [K in keyof Annotation]: Annotation[K] } = { id: value.id, tool, color: value.color, stroke: value.stroke, points: Object.freeze(points) }
        if('blendMode' in value){
            if(!['pen','highlight','text-highlight'].includes(tool)||!profile.blendModes.includes(value.blendMode as Annotation['blendMode'] & string))return fail()
            result.blendMode=value.blendMode as Annotation['blendMode']
        }
        if('markup' in value){
            if(tool!=='text-highlight'||!['highlight','strikeout','underline','squiggle','redaction'].includes(value.markup as string))return fail()
            result.markup=value.markup as Annotation['markup']
        }
        const redaction=tool==='text-highlight'&&value.markup==='redaction'
        for(const key of ['overlayText','overlayColor','repeatOverlayText'] as const){
            if(!(key in value))continue
            if(!redaction)return fail()
            if(key==='overlayText'){
                if(typeof value[key]!=='string'||bytes(value[key])>profile.maxTextBytes||/\p{Cs}/u.test(value[key])||value[key].includes('\0'))return fail()
                result.overlayText=value[key]
            }else if(key==='overlayColor'){
                if(typeof value[key]!=='string'||(!profile.colors.includes(value[key])&&!['#000000','#ffffff'].includes(value[key])))return fail()
                result.overlayColor=value[key]
            }else{
                if(typeof value[key]!=='boolean')return fail()
                result.repeatOverlayText=value[key]
            }
        }
        if(tool==='text-highlight'){
            if(!Array.isArray(value.rectangles)||!value.rectangles.length||value.rectangles.length>profile.maxPoints)return fail()
            result.rectangles=Object.freeze(value.rectangles.map((rect:unknown)=>{
                if(!Array.isArray(rect)||rect.length!==4||rect.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)||rect[2]<=0||rect[3]<=0||rect[0]+rect[2]>1.000001||rect[1]+rect[3]>1.000001)return fail()
                return Object.freeze(rect.map(n=>Math.round(n*1e6)/1e6)) as readonly [number,number,number,number]
            }))
            const rectangles=result.rectangles
            result.points=Object.freeze([
                Object.freeze([Math.min(...rectangles.map(r=>r[0])),Math.min(...rectangles.map(r=>r[1]))]) as Point,
                Object.freeze([Math.min(1,Math.max(...rectangles.map(r=>r[0]+r[2]))),Math.min(1,Math.max(...rectangles.map(r=>r[1]+r[3])))]) as Point,
            ])
        }else if('rectangles' in value)return fail()
        if ('pageIndex' in value) {
            if (typeof value.pageIndex !== 'number' || !bounded(value.pageIndex, 0, profile.maxPages - 1)) return fail()
            result.pageIndex = value.pageIndex
        }
        if (['text', 'callout', 'note', 'stamp'].includes(tool) || (['pin','text-highlight'].includes(tool) && 'text' in value)) {
            if (typeof value.text !== 'string' || (!['note','pin','text-highlight'].includes(tool) && !value.text.trim()) || /\p{Cs}/u.test(value.text) || value.text.includes('\0') || bytes(value.text) > profile.maxTextBytes) return fail()
            result.text = value.text
        } else if ('text' in value) return fail()
        if (tool === 'image' || tool === 'signature') {
            if (typeof value.asset !== 'string' || value.asset.length > 196608 || !/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(value.asset)) return fail()
            result.asset = value.asset
        } else if ('asset' in value) return fail()
        if (tool === 'link') {
            if ('href' in value === ('targetPage' in value)) return fail()
            if ('href' in value) {
                if (typeof value.href !== 'string' || value.href.length > 2048 || !/^https?:\/\/[^\s\\]+$/i.test(value.href)) return fail()
                try { const url = new URL(value.href); if (!url.hostname || url.username || url.password) return fail() } catch { return fail() }
                result.href = value.href
            } else {
                if (typeof value.targetPage !== 'number' || !bounded(value.targetPage, 0, profile.maxPages - 1)) return fail()
                result.targetPage = value.targetPage
            }
        } else if ('href' in value || 'targetPage' in value) return fail()
        if ('noteIcon' in value) {
            if (tool !== 'note' || !profile.noteIcons.includes(value.noteIcon as Annotation['noteIcon'] & string)) return fail()
            result.noteIcon = value.noteIcon as Annotation['noteIcon']
        }
        for (const key of ['startCap','endCap'] as const) {
            if (!(key in value)) continue
            if (!['line','arrow','polyline'].includes(tool) || !profile.lineEndings.includes(value[key] as Annotation['startCap'] & string)) return fail()
            result[key] = value[key] as Annotation['startCap']
        }
        if ('cloudIntensity' in value) {
            if (tool !== 'cloudy-polygon' || typeof value.cloudIntensity !== 'number' || !bounded(value.cloudIntensity,1,3)) return fail()
            result.cloudIntensity=value.cloudIntensity
        }
        if ('opacity' in value) {
            if (typeof value.opacity !== 'number' || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) return fail()
            result.opacity = Math.round(value.opacity * 1e6) / 1e6
        }
        if ('fill' in value) {
            if ((!redaction&&!['rectangle', 'ellipse', 'polygon', 'cloudy-polygon', 'line', 'arrow', 'polyline', 'callout','text','pen','highlight'].includes(tool)) || typeof value.fill !== 'string' || (redaction ? !profile.colors.includes(value.fill)&&value.fill!=='#000000' : value.fill !== 'none' && !profile.colors.includes(value.fill))) return fail()
            result.fill = value.fill
        }
        if ('dash' in value) {
            if (!['rectangle', 'ellipse', 'line', 'arrow', 'polygon', 'cloudy-polygon', 'polyline'].includes(tool) || !['solid', 'dashed', 'dotted'].includes(value.dash as string)) return fail()
            result.dash = value.dash as Annotation['dash']
        }
        for(const key of ['fontFamily','verticalAlign','strokeColor'] as const){
            if(!(key in value))continue
            if(!['text','callout'].includes(tool)||typeof value[key]!=='string')return fail()
            if(key==='fontFamily'&&!profile.textFonts.includes(value[key] as string)
                ||key==='verticalAlign'&&!['top','center','bottom'].includes(value[key] as string)
                ||key==='strokeColor'&&(tool!=='callout'||!profile.colors.includes(value[key] as string)))return fail()
            Object.assign(result,{[key]:value[key]})
        }
        for (const key of ['fontSize', 'bold', 'italic', 'underline', 'align'] as const) {
            if (!(key in value)) continue
            if (tool !== 'text' && tool !== 'callout' && tool !== 'stamp') return fail()
            if (key === 'fontSize') {
                if (typeof value.fontSize !== 'number' || !bounded(value.fontSize, 8, 96)) return fail()
                result.fontSize = value.fontSize
            } else if (key === 'align') {
                if (!['left', 'center', 'right'].includes(value.align as string)) return fail()
                result.align = value.align as Annotation['align']
            } else {
                if (typeof value[key] !== 'boolean') return fail()
                result[key] = value[key]
            }
        }
        return Object.freeze(result)
    })
    if (bytes(JSON.stringify(shapes)) > profile.maxLayerBytes) fail('annotation_layer_limit')
    return Object.freeze(shapes)
}

export function decodeAnnotationDocument(payload: string, configuration: ProfileOptions = {}): readonly Annotation[] {
    const profile = createAnnotationProfile(configuration)
    if (typeof payload !== 'string' || bytes(payload) > profile.maxLayerBytes + 128) return fail('annotation_document_invalid')
    let data: unknown
    try { data = JSON.parse(payload) } catch { return fail('annotation_document_invalid') }
    if (!record(data) || data.version !== annotationSDKVersion || Object.keys(data).some(key => !['version', 'shapes'].includes(key))) return fail('annotation_document_version')
    return normalizeAnnotations(data.shapes, profile)
}

export function createAnnotationDocument({ shapes = [], profile: configuration = {}, historyLimit = 30, historyByteLimit = 4194304,
    onListenerError = (error: unknown): void => queueMicrotask(() => { throw error }) }:
    { shapes?: readonly Annotation[]; profile?: ProfileOptions; historyLimit?: number; historyByteLimit?: number; onListenerError?: (error: unknown) => void } = {}): AnnotationDocument {
    if (!bounded(historyByteLimit, 1024, 16777216)) fail('annotation_history_limit')
    if (!bounded(historyLimit, 0, 100)) fail('annotation_history_limit')
    const profile = createAnnotationProfile(configuration)
    let current = normalizeAnnotations(shapes, profile), encoded = JSON.stringify(current), saved = encoded, disposed = false, sequence = 0
    const undo: (readonly Annotation[])[] = [], redo: (readonly Annotation[])[] = [], listeners = new Set<(event: DocumentEvent) => void>()
    const historySizes = new WeakMap<readonly Annotation[], number>()
    const sizeOf = (value: readonly Annotation[]): number => { let size = historySizes.get(value); if (size === undefined) { size = bytes(JSON.stringify(value)); historySizes.set(value, size) } return size }
    const trimHistory = (): void => {
        while (undo.length + redo.length > historyLimit || [...undo, ...redo].reduce((sum, value) => sum + sizeOf(value), 0) > historyByteLimit) {
            if (undo.length) undo.shift(); else if (redo.length) redo.shift(); else break
        }
    }
    const state = (): DocumentState => Object.freeze({ shapes: current, dirty: encoded !== saved, canUndo: undo.length > 0, canRedo: redo.length > 0, sequence })
    const emit = (command: DocumentEvent['command']): DocumentState => {
        const event: DocumentEvent = Object.freeze({ type: 'change', command, ...state() })
        for (const listener of [...listeners]) { try { listener(event) } catch (error) { onListenerError(error) } }
        return state()
    }
    const ensure = (): void => { if (disposed) fail('annotation_document_disposed') }
    const commit = (next: readonly Annotation[], command: DocumentEvent['command']): DocumentState => {
        const normalized = normalizeAnnotations(next, profile), value = JSON.stringify(normalized)
        if (value === encoded) return state()
        if (historyLimit) undo.push(current)
        redo.length = 0
        const previous = new Map(current.map(shape => [shape.id, shape]))
        current = Object.freeze(normalized.map(shape => { const old = previous.get(shape.id); return old && JSON.stringify(old) === JSON.stringify(shape) ? old : shape }))
        trimHistory(); encoded = value; sequence++; return emit(command)
    }
    return Object.freeze({
        getState(): DocumentState { ensure(); return state() },
        subscribe(listener: (event: DocumentEvent) => void): () => void { ensure(); if (typeof listener !== 'function') fail('annotation_listener_invalid'); listeners.add(listener); return () => { listeners.delete(listener) } },
        dispatch(command: AnnotationCommand): DocumentState {
            ensure(); if (profile.readOnly) fail('annotation_read_only')
            switch (command?.type) {
                case 'add': return commit([...current, command.shape], 'add')
                case 'update':
                    if (!current.some(shape => shape.id === command.id)) return fail('annotation_not_found')
                    if (!command.patch || Object.hasOwn(command.patch, 'id')) return fail()
                    return commit(current.map(shape => shape.id === command.id ? { ...shape, ...command.patch } : shape), 'update')
                case 'remove': return commit(current.filter(shape => shape.id !== command.id), 'remove')
                case 'clear': return commit([], 'clear')
                case 'replace': return commit(command.shapes, 'replace')
                case 'undo': if (undo.length) { redo.push(current); current = undo.pop()!; encoded = JSON.stringify(current); sequence++; trimHistory(); return emit('undo') } return state()
                case 'redo': if (redo.length) { undo.push(current); current = redo.pop()!; encoded = JSON.stringify(current); sequence++; trimHistory(); return emit('redo') } return state()
                default: return fail('annotation_command_invalid')
            }
        },
        markSaved(snapshot: readonly Annotation[] = current): DocumentState { ensure(); saved = JSON.stringify(normalizeAnnotations(snapshot, profile)); return emit('saved') },
        export(): string { ensure(); return JSON.stringify({ version: annotationSDKVersion, shapes: current }) },
        import(payload: string): DocumentState {
            ensure(); if (profile.readOnly) fail('annotation_read_only')
            return commit(decodeAnnotationDocument(payload, profile), 'import')
        },
        dispose(): void { if (disposed) return; disposed = true; listeners.clear(); undo.length = redo.length = 0; current = []; encoded = saved = '' },
    })
}
