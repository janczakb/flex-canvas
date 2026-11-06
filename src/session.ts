import { createAnnotationDocument, decodeAnnotationDocument } from './document.js'
import { AnnotationError, type Annotation, type AnnotationCommand, type DocumentState, type ProfileOptions } from './types.js'
import type { PageInfo, PageRender, RenderOptions, PDFOptions } from './pdf.js'

export interface DocumentAdapter {
    readonly pageCount: number
    getPageInfo(index: number): Promise<PageInfo>
    getText(index: number): Promise<string>
    renderPage(index: number, canvas: HTMLCanvasElement, options?: RenderOptions): Promise<PageRender>
    releasePage(canvas: HTMLCanvasElement): void
    destroy(): Promise<void> | void
}
export type MediaSource = { kind: 'image'; url: string } | { kind: 'pdf'; source: string | Uint8Array; pdf: Omit<PDFOptions, 'source' | 'signal'> }
export interface LayerSnapshot { readonly data: string; readonly revision: number }
export interface LayerStorage {
    load(signal: AbortSignal): Promise<LayerSnapshot>
    save(request: LayerSnapshot & { readonly operation: string; readonly signal: AbortSignal }): Promise<{ readonly revision: number }>
}
export interface MediaSessionOptions {
    source: MediaSource
    adapter?: DocumentAdapter
    annotations?: readonly Annotation[]
    profile?: ProfileOptions
    historyLimit?: number
    mode?: 'edit' | 'read'
    storage?: LayerStorage
    signal?: AbortSignal
}
export interface MediaSessionState extends DocumentState {
    readonly pageIndex: number
    readonly pageCount: number
    readonly mode: 'edit' | 'read'
    readonly saving: boolean
    readonly revision: number
}

const abortError = (): DOMException => new DOMException('Media session closed', 'AbortError')

async function imageAdapter(url: string, signal: AbortSignal): Promise<DocumentAdapter> {
    const image = new Image()
    image.decoding = 'async'; image.src = url
    let closed = false
    const cancel = (): void => { closed = true; image.src = '' }
    signal.addEventListener('abort', cancel, { once: true })
    try { await image.decode() } catch (error) { signal.removeEventListener('abort', cancel); if (signal.aborted) throw abortError(); throw error }
    const check = (index: number): void => { if (closed || signal.aborted) throw abortError(); if (index !== 0) throw new RangeError('Image page index must be zero') }
    return Object.freeze({
        pageCount: 1,
        async getPageInfo(index: number): Promise<PageInfo> { check(index); return Object.freeze({ pageIndex: 0, width: image.naturalWidth, height: image.naturalHeight, rotation: 0 }) },
        async getText(index: number): Promise<string> { check(index); return '' },
        async renderPage(index: number, canvas: HTMLCanvasElement, { scale = 1, pixelRatio = globalThis.devicePixelRatio || 1 }: RenderOptions = {}): Promise<PageRender> {
            check(index)
            if (!Number.isFinite(scale) || scale <= 0 || scale > 16 || !Number.isFinite(pixelRatio) || pixelRatio <= 0 || pixelRatio > 8) throw new RangeError('Invalid image render scale')
            const width = image.naturalWidth * scale, height = image.naturalHeight * scale
            const ratio = Math.min(pixelRatio, 4096 / width, 4096 / height, Math.sqrt(4194304 / (width * height)))
            canvas.width = Math.max(1, Math.floor(width * ratio)); canvas.height = Math.max(1, Math.floor(height * ratio))
            const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 2D is unavailable')
            context.drawImage(image, 0, 0, canvas.width, canvas.height)
            return Object.freeze({ pageIndex: 0, width, height, pixelWidth: canvas.width, pixelHeight: canvas.height })
        },
        releasePage(canvas: HTMLCanvasElement): void { canvas.width = canvas.height = 1 },
        destroy(): void { if (closed) return; closed = true; signal.removeEventListener('abort', cancel); image.src = '' },
    })
}

/** Independent media/document kernel. Applications choose their UI and trusted storage adapter. */
export async function createMediaSession(options: MediaSessionOptions) {
    const lifecycle = new AbortController(), signal = lifecycle.signal
    if (options.signal?.aborted) throw abortError()
    let source: DocumentAdapter | undefined
    const abort = (): void => { lifecycle.abort() }
    options.signal?.addEventListener('abort', abort, { once: true })
    const loadSource = async (): Promise<DocumentAdapter> => {
        if (options.adapter) return options.adapter
        if (options.source.kind === 'image') return imageAdapter(options.source.url, signal)
        const { openPDF } = await import('./pdf.js')
        if (signal.aborted) throw abortError()
        return openPDF({ ...options.source.pdf, source: options.source.source, signal })
    }
    try {
        source = await loadSource()
        if (signal.aborted) throw abortError()
        const snapshot = await options.storage?.load(signal)
        if (signal.aborted) throw abortError()
        const profile = { ...options.profile, maxPages: Math.min(options.profile?.maxPages ?? source.pageCount, source.pageCount) }
        const model = createAnnotationDocument({ shapes: snapshot ? decodeAnnotationDocument(snapshot.data, profile) : options.annotations, profile, historyLimit: options.historyLimit })
        let pageIndex = 0, mode = profile.readOnly ? 'read' as const : options.mode ?? 'edit', saving = false, disposed = false
        let revision = snapshot?.revision ?? 0, pending: {data: string; revision: number; operation: string} | undefined
        if (!Number.isSafeInteger(revision) || revision < 0) throw new AnnotationError('annotation_revision_invalid')
        const listeners = new Set<(state: MediaSessionState) => void>()
        const state = (): MediaSessionState => Object.freeze({ ...model.getState(), pageIndex, pageCount: source!.pageCount, mode, saving, revision })
        const assert = (): void => { if (disposed || signal.aborted) throw abortError() }
        const page = (index: number): void => { if (!Number.isInteger(index) || index < 0 || index >= source!.pageCount) throw new RangeError('Invalid document page index') }
        const emit = (): void => { if (!disposed) { const event = state(); for (const listener of [...listeners]) listener(event) } }
        const stop = model.subscribe(emit)
        const destroy = async (): Promise<void> => {
            if (disposed) return
            disposed = true; options.signal?.removeEventListener('abort', abort); signal.removeEventListener('abort', onAbort)
            lifecycle.abort(); stop(); listeners.clear(); model.dispose(); await source!.destroy()
        }
        const onAbort = (): void => { void destroy() }
        signal.addEventListener('abort', onAbort, { once: true })
        return Object.freeze({
            getState(): MediaSessionState { assert(); return state() },
            subscribe(listener: (state: MediaSessionState) => void): () => void { assert(); listeners.add(listener); return () => { listeners.delete(listener) } },
            getAnnotations(index?: number): readonly Annotation[] { assert(); if (index !== undefined) page(index); return index === undefined ? model.getState().shapes : Object.freeze(model.getState().shapes.filter(shape => (shape.pageIndex ?? 0) === index)) },
            dispatch(command: AnnotationCommand): DocumentState { assert(); if (mode === 'read') throw new AnnotationError('annotation_read_only'); return model.dispatch(command) },
            setReaderView(enabled: boolean): MediaSessionState { assert(); mode = enabled || profile.readOnly ? 'read' : 'edit'; emit(); return state() },
            setPage(index: number): MediaSessionState { assert(); page(index); pageIndex = index; emit(); return state() },
            async getPageInfo(index = pageIndex): Promise<PageInfo> { assert(); page(index); const result = await source!.getPageInfo(index); assert(); return result },
            async getText(index = pageIndex): Promise<string> { assert(); page(index); const result = await source!.getText(index); assert(); return result },
            async renderPage(canvas: HTMLCanvasElement, render: RenderOptions = {}, index = pageIndex): Promise<PageRender> { assert(); page(index); const result = await source!.renderPage(index, canvas, { ...render, signal: render.signal ?? signal }); assert(); return result },
            releasePage(canvas: HTMLCanvasElement): void { assert(); source!.releasePage(canvas) },
            export(): string { assert(); return model.export() },
            import(data: string): DocumentState { assert(); if (mode === 'read') throw new AnnotationError('annotation_read_only'); return model.import(data) },
            async save(): Promise<MediaSessionState> {
                assert(); if (mode === 'read') throw new AnnotationError('annotation_read_only')
                if (!options.storage) throw new AnnotationError('annotation_storage_missing')
                if (saving) throw new AnnotationError('annotation_save_pending')
                if (!model.getState().dirty) return state()
                const data = model.export(), shapes = model.getState().shapes
                if (pending?.data !== data || pending.revision !== revision) pending = { data, revision, operation: crypto.randomUUID() }
                saving = true; emit()
                try {
                    const result = await options.storage.save({ ...pending, signal })
                    assert()
                    if (!Number.isSafeInteger(result.revision) || result.revision <= revision) throw new AnnotationError('annotation_revision_invalid')
                    revision = result.revision; pending = undefined; model.markSaved(shapes)
                } finally { if (!disposed) { saving = false; emit() } }
                return state()
            },
            destroy,
        })
    } catch (error) { options.signal?.removeEventListener('abort', abort); lifecycle.abort(); await source?.destroy(); throw error }
}
export type MediaSession = Awaited<ReturnType<typeof createMediaSession>>
export const openDocument = createMediaSession
export const openReader = (options: MediaSessionOptions): Promise<MediaSession> => createMediaSession({ ...options, mode: 'read' })
