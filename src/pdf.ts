import {validatePDFTextEdits,type PDFTextBlock,type PDFTextEdit} from './pdf/text-edit.js'
export type {PDFTextAppearance,PDFTextBlock,PDFTextEdit,PDFTextFamily} from './pdf/text-edit.js'
import {validatePDFCrops,type PDFCrop} from './pdf/crop.js'
export type {PDFCrop,PDFCropBox} from './pdf/crop.js'
import {validatePDFRedactions,type PDFRedaction} from './pdf/redactions.js'
export type {PDFRedaction} from './pdf/redactions.js'
import { validatePagePlan, type PDFPageEdit } from './pdf/page-plan.js'
export type { PDFPageEdit } from './pdf/page-plan.js'
import {pdfSelectionLines} from './pdf/text-lines.js'
import { PDFEngineError, type PageInfo, type PageRender, type PDFRenderPriority, type RenderOptions } from './pdf/types.js'
import {probePDFRange,type PDFSourceDescriptor} from './pdf/random-access.js'
import { integerLimit, readBoundedBytes } from './pdf/source.js'
import type { OutlineItem, PageText, PDFLink, PDFMetadata, PDFPageOverlay, PDFMethod, PDFMethods, PDFResponse, PDFSourceProgress, PDFTile, BitmapRaster, Raster, SearchHit } from './pdf/protocol.js'
export { PDFEngineError } from './pdf/types.js'
export type { PageInfo, PageRender, RenderOptions } from './pdf/types.js'
export type { OutlineItem, PageText, PDFLink, PDFMetadata, PDFTile, SearchHit } from './pdf/protocol.js'

export interface PDFProgress {phase:'source-read'|'download'|'engine'|'opening'|'render'|'ready';loaded:number;total:number|null;pageIndex?:number}
export interface PDFOptions {
    onProgress?:(progress:PDFProgress)=>void
    source: string | Uint8Array | Blob
    rasterTransport?:'auto'|'rgba'|'bitmap'
    loading?:'auto'|'memory'|'range'
    workerUrl: string
    wasmUrl: string
    /** Self-hosted Unicode overlay font; fetched only when applying labeled redactions. */
    redactionFontUrl?:string
    password?: string
    maxPages?: number
    maxBytes?: number
    maxCanvasPixels?: number
    maxQueuedPages?: number
    operationTimeoutMs?: number
    /** Total download + engine opening deadline, including a stalled HTTP stream. */
    openTimeoutMs?: number
    headers?: Record<string, string>
    withCredentials?: boolean
    signal?: AbortSignal
}
export interface IndependentPDFDocument {
    readonly pageCount: number
    readonly canEditPages: boolean
    getBytes(): Promise<ArrayBuffer>
    exportPDF(overlays?: readonly PDFPageOverlay[], maxOutputBytes?: number): Promise<ArrayBuffer>
    getTextBlocks(index:number,signal?:AbortSignal):Promise<PDFTextBlock[]>
    previewText(index:number,edits:readonly PDFTextEdit[],width:number,height:number,signal?:AbortSignal):Promise<import('./pdf/protocol.js').PDFTextPreview>
    editText(edits:readonly PDFTextEdit[],maxOutputBytes?:number):Promise<ArrayBuffer>
    cropPages(crops: readonly PDFCrop[], maxOutputBytes?: number):Promise<ArrayBuffer>
    applyRedactions(redactions:readonly PDFRedaction[],maxOutputBytes?:number):Promise<ArrayBuffer>
    editPages(pages: readonly PDFPageEdit[], maxOutputBytes?: number): Promise<ArrayBuffer>
    getPageSizes():Promise<readonly {width:number;height:number}[]>
    getPageInfo(index: number): Promise<PageInfo>
    getText(index: number): Promise<string>
    getTextContent(index: number): Promise<PageText>
    searchPage(index: number, query: string, options?: {matchCase?: boolean; wholeWord?: boolean; limit?: number; signal?: AbortSignal}): Promise<SearchHit[]>
    getOutline(): Promise<OutlineItem[]>
    getMetadata(): Promise<PDFMetadata>
    getLinks(index: number): Promise<PDFLink[]>
    renderPage(index: number, canvas: HTMLCanvasElement, options?: RenderOptions): Promise<PageRender>
    renderTileBitmap?(index:number,tile:PDFTile,signal?:AbortSignal,priority?:PDFRenderPriority):Promise<BitmapRaster>
    renderTile(index: number, tile: PDFTile, signal?: AbortSignal, priority?: PDFRenderPriority): Promise<Raster>
    renderTextLayer(index: number, container: HTMLElement, scale?: number, signal?: AbortSignal, priority?: PDFRenderPriority): Promise<void>
    clearTextLayer(container: HTMLElement): void
    releasePage(canvas: HTMLCanvasElement): void
    destroy(): Promise<void>
}
export const pdfEngineCapabilities = Object.freeze({implementation: 'pdfium', rendering: true, textSelection: true, search: true, outlines: true, links: true, pageEditing: true, nativeAnnotationExport: false, contentEditing: false})
const aborted = (): DOMException => new DOMException('PDF operation cancelled', 'AbortError')

/** Engine resources are explicit, self-hosted and fetched only when a PDF is opened. */
export async function openPDF(options: PDFOptions): Promise<IndependentPDFDocument> {
    if(options.loading!==undefined&&!['auto','memory','range'].includes(options.loading))throw new RangeError('Invalid PDF loading mode')
    if(options.rasterTransport!==undefined&&!['auto','rgba','bitmap'].includes(options.rasterTransport))throw new RangeError('Invalid PDF raster transport')
    if (options.signal?.aborted) throw aborted()
    const maxPages = integerLimit(options.maxPages, 2000, 1, 10000), maxBytes = integerLimit(options.maxBytes, 104857600, 1, 2147483647)
    const maxPixels = integerLimit(options.maxCanvasPixels, 4194304, 1024, 16777216), maxQueue = integerLimit(options.maxQueuedPages, 16, 1, 32)
    const timeout = integerLimit(options.operationTimeoutMs, 30000, 1000, 120000)
    const openingTimeout=integerLimit(options.openTimeoutMs,60000,1000,120000)
    if (!options.workerUrl || !options.wasmUrl) throw new PDFEngineError('pdf_resources_missing', 'PDF worker and WebAssembly URLs are required.')
    const lifecycle = new AbortController(), parentAbort = (): void => lifecycle.abort()
    options.signal?.addEventListener('abort', parentAbort, {once: true})
    let worker: Worker | undefined, bootstrapUrl: string | undefined, closed = false, sequence = 0
    let openingTimer:ReturnType<typeof setTimeout>|undefined
    const releaseBootstrap = (): void => { if (bootstrapUrl) { URL.revokeObjectURL(bootstrapUrl); bootstrapUrl = undefined } }
    type Pending = {resolve(value: unknown): void; reject(error: unknown): void; cleanup(): void; start(): void; priority: PDFRenderPriority;visual:boolean;cancelled?:boolean}
    let useBitmaps=false
    let active:number|undefined
    const requests = new Map<number, Pending>(), renders = new WeakMap<HTMLCanvasElement, number>(), textLayers = new Map<HTMLElement, object>()
    const infos = new Map<number, PageInfo>()
    const pendingInfos = new Map<number, Promise<PageInfo>>()
    const terminate = (error: Error): void => {
        if (closed) return
        closed = true
        clearTimeout(openingTimer)
        releaseBootstrap()
        if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); worker = undefined }
        options.signal?.removeEventListener('abort', parentAbort)
        lifecycle.signal.removeEventListener('abort', onAbort); lifecycle.abort()
        for (const pending of requests.values()) { pending.cleanup(); pending.reject(error) }
        requests.clear(); infos.clear(); pendingInfos.clear()
        for (const container of textLayers.keys()) container.replaceChildren()
        textLayers.clear()
    }
    const onAbort = (): void => terminate(aborted())
    lifecycle.signal.addEventListener('abort', onAbort, {once: true})
    const assert = (): void => { if (closed || lifecycle.signal.aborted) throw aborted() }
    const pump = ():void => {
        if(active!==undefined||closed)return
        let command:[number,Pending]|undefined,visible:[number,Pending]|undefined,background:[number,Pending]|undefined
        for(const entry of requests){
            if(entry[1].cancelled)continue
            if(entry[1].priority==='foreground'){
                if(entry[1].visual)visible=entry // Latest visible raster wins within its priority.
                else command??=entry // Preserve order of reads, edits and exports.
            }else if(!background||entry[1].visual)background=entry
        }
        const next=command??visible??background
        if(next){active=next[0];next[1].start()}
    }
    const call = <K extends PDFMethod>(method: K, input: PDFMethods[K]['input'], signal?: AbortSignal, transfer: Transferable[] = [], priority: PDFRenderPriority='foreground'): Promise<PDFMethods[K]['output']> => {
        assert()
        if (signal?.aborted) return Promise.reject(aborted())
        if (requests.size >= maxQueue) return Promise.reject(new PDFEngineError('pdf_queue_limit', 'PDF work queue is full.'))
        return new Promise((resolve, reject) => {
            const id=++sequence
            let timer:ReturnType<typeof setTimeout>|undefined
            const cancel=():void=>{
                const pending=requests.get(id);if(pending)pending.cancelled=true
                reject(aborted())
                if(active===id)worker?.postMessage({id:++sequence,method:'cancel',input:{requestId:id}})
                if(active!==id){requests.delete(id);cleanup()}
            }
            const cleanup=():void=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
            const start=():void=>{
                timer=setTimeout(()=>terminate(new PDFEngineError('pdf_worker_timeout','PDF worker exceeded its time budget.')),timeout)
                try {worker!.postMessage({id,method,input},transfer)}
                catch(error){requests.delete(id);active=undefined;cleanup();reject(error);pump()}
            }
            requests.set(id,{priority,visual:['render','renderBitmap','renderTile','renderTileBitmap'].includes(method),start,resolve:value=>resolve(value as PDFMethods[K]['output']),reject,cleanup})
            signal?.addEventListener('abort',cancel,{once:true})
            pump()
        })
    }
    openingTimer=setTimeout(()=>terminate(new PDFEngineError('pdf_open_timeout','PDF opening exceeded its time budget.')),openingTimeout)
    try {
        const workerUrl = globalThis.location ? new URL(options.workerUrl, globalThis.location.href) : undefined
        // A module worker entry must be same-origin. The small owned bootstrap
        // imports the version-pinned CDN module through the browser's CORS checks.
        if (workerUrl && /^https?:$/.test(workerUrl.protocol) && workerUrl.origin !== globalThis.location.origin) {
            bootstrapUrl = URL.createObjectURL(new Blob(['import ' + JSON.stringify(workerUrl.href) + ';'], {type: 'text/javascript'}))
        }
        worker = new Worker(bootstrapUrl ?? workerUrl?.href ?? options.workerUrl, {type: 'module', name: 'flex-pdfium'})
        worker.onmessage = ({data}: MessageEvent<PDFResponse|PDFSourceProgress>): void => {
            if('event' in data){options.onProgress?.({phase:'source-read',loaded:data.loaded,total:data.total});return}
            releaseBootstrap()
            const pending = requests.get(data?.id)
            if (!pending){if(data?.ok&&data.value&&typeof data.value==='object'&&'bitmap' in data.value)(data.value as BitmapRaster).bitmap.close();return}
            requests.delete(data.id); active=undefined; pending.cleanup()
            if (data.ok){if(pending.cancelled&&data.value&&typeof data.value==='object'&&'bitmap' in data.value)(data.value as BitmapRaster).bitmap.close();pending.resolve(data.value)}
            else pending.reject(new PDFEngineError(data.code, 'The PDF operation could not be completed.'))
            queueMicrotask(pump)
        }
        worker.onerror = event => { event.preventDefault(); terminate(new PDFEngineError('pdf_worker_failed', 'The PDF worker could not start.')) }
        worker.onmessageerror = () => terminate(new PDFEngineError('pdf_worker_failed', 'The PDF worker returned an invalid response.'))
        options.onProgress?.({phase:'engine',loaded:0,total:1})
        const preparation=call('prepare',{wasmUrl:options.wasmUrl}).then(capabilities=>{useBitmaps=capabilities!==true&&capabilities.bitmap&&options.rasterTransport!=='rgba';if(options.rasterTransport==='bitmap'&&!useBitmaps)throw new PDFEngineError('pdf_bitmap_unavailable','ImageBitmap transport is unavailable.');options.onProgress?.({phase:'engine',loaded:1,total:1})})
        const source=(async():Promise<Uint8Array|PDFSourceDescriptor>=>{
            if(options.source instanceof Blob){
                if(options.source.size>maxBytes)throw new PDFEngineError('pdf_size_limit','PDF source exceeds the byte limit.')
                if(options.loading!=='memory')return {kind:'blob',blob:options.source}
                if(options.source.size>104857600)throw new PDFEngineError('pdf_size_limit','In-memory PDF source exceeds the memory limit.')
                return new Uint8Array(await options.source.arrayBuffer())
            }
            if(typeof options.source==='string'&&options.loading!=='memory'){
                const ranged=await probePDFRange(options.source,maxBytes,{headers:options.headers,withCredentials:options.withCredentials,signal:lifecycle.signal})
                if(ranged)return ranged
                if(options.loading==='range')throw new PDFEngineError('pdf_range_unavailable','Verified range delivery is unavailable.')
            }
            let bytes:Uint8Array
            if(typeof options.source==='string')bytes=await readBoundedBytes(options.source,Math.min(maxBytes,104857600),{signal:lifecycle.signal,headers:options.headers,credentials:options.withCredentials?'include':'same-origin'},(loaded,total)=>options.onProgress?.({phase:'download',loaded,total}))
            else{
                if(!(options.source instanceof Uint8Array)||options.source.byteLength>Math.min(maxBytes,104857600))throw new PDFEngineError('pdf_size_limit','PDF source exceeds the in-memory limit.')
                bytes=options.source.slice()
            }
            assert();if(bytes.length<5)throw new PDFEngineError('pdf_invalid','PDF source is empty or incomplete.')
            return bytes
        })()
        const [,input]=await Promise.all([preparation,source]);assert()
        options.onProgress?.({phase:'opening',loaded:0,total:1})
        const common={wasmUrl:options.wasmUrl,password:options.password??'',maxPages}
        const {pageCount,canEditPages}=input instanceof Uint8Array
            ?await call('open',{...common,bytes:input.buffer as ArrayBuffer},undefined,[input.buffer as ArrayBuffer])
            :await call('openSource',{...common,source:input})
        clearTimeout(openingTimer)
        options.onProgress?.({phase:'opening',loaded:1,total:1})
        const page = (index: number): void => { assert(); if (!Number.isSafeInteger(index) || index < 0 || index >= pageCount) throw new RangeError('Invalid PDF page index') }
        const info = (index: number): Promise<PageInfo> => {
            page(index)
            const cached=infos.get(index)
            if(cached){infos.delete(index);infos.set(index,cached);return Promise.resolve(cached)}
            const pending=pendingInfos.get(index)
            if(pending)return pending
            const request=call('info',{index}).then(result=>{
                assert()
                if (!(result.width > 0 && result.height > 0) || !Number.isFinite(result.width * result.height)) throw new PDFEngineError('pdf_page_invalid', 'Invalid PDF page dimensions.')
                if(infos.size>=128)infos.delete(infos.keys().next().value!)
                const value=Object.freeze(result);infos.set(index,value);return value
            }).finally(()=>pendingInfos.delete(index))
            pendingInfos.set(index,request);return request
        }
        const clearTextLayer = (container: HTMLElement): void => { textLayers.delete(container); container.replaceChildren() }
        return Object.freeze({
            pageCount, canEditPages,
            getBytes: () => call('bytes', {}),
            async exportPDF(overlays: readonly PDFPageOverlay[] = [], maxOutputBytes = maxBytes): Promise<ArrayBuffer> {
                return overlays.length ? call('exportPDF', {
                    overlays, maxBytes: integerLimit(maxOutputBytes, maxBytes, 1, maxBytes),
                }, undefined, overlays.map(overlay => overlay.rgba)) : call('bytes', {})
            },
            getTextBlocks(index:number,signal?:AbortSignal){page(index);return call('textBlocks',{index},signal,[],'background')},
            previewText(index:number,edits:readonly PDFTextEdit[],width:number,height:number,signal?:AbortSignal){page(index);validatePDFTextEdits(edits,pageCount);return call('previewText',{index,edits,width,height},signal)},
            async editText(edits:readonly PDFTextEdit[],maxOutputBytes=maxBytes){
                validatePDFTextEdits(edits,pageCount)
                return call('editText',{edits,maxBytes:integerLimit(maxOutputBytes,maxBytes,1,maxBytes)})
            },
            async cropPages(crops:readonly PDFCrop[],maxOutputBytes=maxBytes){
                validatePDFCrops(crops,pageCount)
                return call('crop',{crops,maxBytes:integerLimit(maxOutputBytes,maxBytes,1,maxBytes)})
            },
            async applyRedactions(redactions:readonly PDFRedaction[],maxOutputBytes=maxBytes){
                validatePDFRedactions(redactions,pageCount)
                assert()
                const font=redactions.some(item=>!!item.overlayText)
                    ? await readBoundedBytes(options.redactionFontUrl??new URL('redaction-regular.ttf',new URL(options.wasmUrl,globalThis.location?.href)).href,2097152,{signal:lifecycle.signal,credentials:'omit'})
                    : undefined
                return call('redact',{redactions,maxBytes:integerLimit(maxOutputBytes,maxBytes,1,maxBytes),...(font?{font:font.buffer as ArrayBuffer}:{})},undefined,font?[font.buffer]:[])

            },
            async editPages(pages: readonly PDFPageEdit[], maxOutputBytes = maxBytes): Promise<ArrayBuffer> {
                validatePagePlan(pages, pageCount, maxPages)
                return call('editPages', {pages, maxBytes: integerLimit(maxOutputBytes, maxBytes, 1, maxBytes)})
            },
            getPageSizes: () => call('sizes', {}),
            getPageInfo: info,
            async getText(index: number): Promise<string> { page(index); return (await call('text', {index, geometry: false})).text },
            async getTextContent(index: number): Promise<PageText> { page(index); return call('text', {index, geometry: true}) },
            async searchPage(index: number, query: string, {matchCase = false, wholeWord = false, limit = 100, signal}: {matchCase?: boolean; wholeWord?: boolean; limit?: number; signal?: AbortSignal} = {}): Promise<SearchHit[]> {
                page(index); return call('search', {index, query, matchCase, wholeWord, limit}, signal)
            },
            getOutline: () => call('outline', {}),
            getMetadata: () => call('metadata', {}),
            async getLinks(index: number): Promise<PDFLink[]> { page(index); return call('links', {index}) },
            async renderPage(index: number, canvas: HTMLCanvasElement, {scale = 1, pixelRatio = globalThis.devicePixelRatio || 1, signal, priority = 'foreground'}: RenderOptions = {}): Promise<PageRender> {
                page(index)
                if (!Number.isFinite(scale) || scale <= 0 || scale > 32 || !Number.isFinite(pixelRatio) || pixelRatio <= 0 || pixelRatio > 8) throw new RangeError('Invalid PDF scale')
                const generation = (renders.get(canvas) ?? 0) + 1; renders.set(canvas, generation)
                const pageInfo = await info(index), width = pageInfo.width * scale, height = pageInfo.height * scale
                assert(); if (signal?.aborted || renders.get(canvas) !== generation) throw aborted()
                const ratio = Math.min(pixelRatio, 8192 / width, 8192 / height, Math.sqrt(maxPixels / (width * height)))
                const pixelWidth = Math.max(1, Math.floor(width * ratio)), pixelHeight = Math.max(1, Math.floor(height * ratio))
                const raster=useBitmaps?await call('renderBitmap',{index,width:pixelWidth,height:pixelHeight},signal,[],priority):await call('render',{index,width:pixelWidth,height:pixelHeight},signal,[],priority)
                try{
                    assert();if(signal?.aborted||renders.get(canvas)!==generation)throw aborted()
                    const context=canvas.getContext('2d');if(!context)throw new PDFEngineError('pdf_canvas_failed','Canvas 2D is unavailable.')
                    canvas.width=pixelWidth;canvas.height=pixelHeight
                    if('bitmap' in raster)context.drawImage(raster.bitmap,0,0)
                    else context.putImageData(new ImageData(new Uint8ClampedArray(raster.rgba),pixelWidth,pixelHeight),0,0)
                }finally{if('bitmap' in raster)raster.bitmap.close()}
                return Object.freeze({pageIndex: index, width, height, pixelWidth, pixelHeight})
            },
            ...(useBitmaps?{async renderTileBitmap(index:number,tile:PDFTile,signal?:AbortSignal,priority:PDFRenderPriority='background'){page(index);return call('renderTileBitmap',{index,tile},signal,[],priority)}}:{}),
            async renderTile(index: number,tile: PDFTile,signal?: AbortSignal,priority:PDFRenderPriority='background'): Promise<Raster> {
                page(index);return call('renderTile',{index,tile},signal,[],priority)
            },
            async renderTextLayer(index: number, container: HTMLElement, scale = 1, signal?:AbortSignal, priority:PDFRenderPriority='foreground'): Promise<void> {
                page(index)
                if (!(scale > 0) || !Number.isFinite(scale)) throw new RangeError('Invalid text scale')
                const token = {}; textLayers.set(container, token)
                const pageInfo = await info(index)
                if(signal?.aborted||textLayers.get(container)!==token)return
                const content = await call('text', {index, geometry: true},signal,[],priority)
                assert(); if (signal?.aborted||textLayers.get(container) !== token) return
                const fragment = container.ownerDocument.createDocumentFragment(), width = pageInfo.width * scale, height = pageInfo.height * scale
                const measure=container.ownerDocument.createElement('canvas').getContext('2d')
                let sliceStart=performance.now(),glyphCount=0
                for(const [lineIndex,line] of pdfSelectionLines(content).entries()){
                    const top=line.y*height,lineHeight=line.height*height
                    for(const item of line.glyphs){
                        const span=container.ownerDocument.createElement('span'),advance=item.width*width
                        span.textContent=item.glyph.text
                        const fontSize=Math.max(1,lineHeight)
                        if(measure)measure.font=`${fontSize}px sans-serif`
                        const textWidth=measure?.measureText(item.glyph.text).width??advance
                        span.style.cssText=`position:absolute;left:${item.x*width}px;top:${top}px;width:${textWidth}px;height:${lineHeight}px;font-size:${fontSize}px;line-height:${lineHeight}px;transform:scaleX(${advance/(textWidth||1)});color:transparent;white-space:pre;`
                        span.dataset.fffTextLine=String(lineIndex)
                        span.dataset.fffTextBox=JSON.stringify([item.x,line.y,item.width,line.height])
                        fragment.append(span)
                        if(++glyphCount%256===0&&performance.now()-sliceStart>=6){
                            await new Promise<void>(resolve=>setTimeout(resolve,0))
                            if(closed||signal?.aborted||textLayers.get(container)!==token)return
                            sliceStart=performance.now()
                        }
                    }
                }
                container.replaceChildren(fragment)
                container.setAttribute('aria-label', content.text.slice(0, 10000))
            },
            clearTextLayer,
            releasePage(canvas: HTMLCanvasElement): void { renders.set(canvas, (renders.get(canvas) ?? 0) + 1); canvas.width = canvas.height = 1 },
            async destroy(): Promise<void> { terminate(aborted()) },
        })
    } catch (error) { terminate(error instanceof Error ? error : new PDFEngineError('pdf_open_failed', 'Unable to open PDF.')); throw error }
}
