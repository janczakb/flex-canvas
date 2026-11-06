import type { IndependentPDFDocument } from '../pdf.js'

export interface ThumbnailOptions {
    document: IndependentPDFDocument
    root: HTMLElement
    width?: number
    /** Stable raster long edge; CSS display dimensions may change independently. */
    maxSize?:number
    onError?: (error: unknown) => void
}

const thumbnailCaches=new WeakMap<IndependentPDFDocument,{images:Map<string,ImageData>;bytes:number}>()
const thumbnailBudget=4*1024*1024

/** Only visible, owner-attached canvases enter the single-flight thumbnail queue. */
export function createPDFThumbnails({document, root, width = 160, maxSize, onError}: ThumbnailOptions) {
    if (!Number.isFinite(width) || width < 32 || width > 512) throw new RangeError('Invalid thumbnail width')
    if(maxSize!==undefined&&(!Number.isFinite(maxSize)||maxSize<32||maxSize>512))throw new RangeError('Invalid thumbnail raster size')
    type Entry = {index: number; canvas: HTMLCanvasElement; visible: boolean; rendered: boolean; controller?: AbortController; width:number}
    const entries = new Map<HTMLCanvasElement, Entry>()
    let closed = false, busy = false
    const cache=thumbnailCaches.get(document)??{images:new Map<string,ImageData>(),bytes:0}
    thumbnailCaches.set(document,cache)
    const pixelRatio=Math.min(2,root.ownerDocument.defaultView?.devicePixelRatio||1)
    const key=(entry:Entry)=>(maxSize??entry.width)+':'+pixelRatio+':'+entry.index
    const restore=(entry:Entry):boolean=>{
        const id=key(entry), pixels=cache.images.get(id)
        if(!pixels)return false
        cache.images.delete(id);cache.images.set(id,pixels)
        entry.canvas.width=pixels.width;entry.canvas.height=pixels.height
        entry.canvas.getContext('2d')?.putImageData(pixels,0,0)
        entry.rendered=true;entry.canvas.dataset.loaded='true'
        return true
    }
    const remember=(entry:Entry):void=>{
        const id=key(entry), previous=cache.images.get(id)
        if(previous)return
        const {canvas}=entry,pixels=canvas.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height)
        if(!pixels||pixels.data.byteLength>thumbnailBudget)return
        cache.images.set(id,pixels);cache.bytes+=pixels.data.byteLength
        while(cache.bytes>thumbnailBudget){
            const first=cache.images.keys().next().value!
            cache.bytes-=cache.images.get(first)!.data.byteLength;cache.images.delete(first)
        }
    }
    const run = async (): Promise<void> => {
        if (closed || busy) return
        const viewport=root.getBoundingClientRect(), center=(viewport.top+viewport.bottom)/2
        const entry = [...entries.values()].filter(item => item.visible && !item.rendered && !item.controller).map(item=>{
            const rect=item.canvas.getBoundingClientRect()
            return {item, visible:rect.bottom>viewport.top&&rect.top<viewport.bottom,distance:Math.abs((rect.top+rect.bottom)/2-center)}
        }).sort((a,b)=>Number(b.visible)-Number(a.visible)||a.distance-b.distance)[0]?.item
        if (!entry) return
        if(restore(entry)){void run();return}
        busy = true; entry.controller = new AbortController()
        const renderWidth=entry.width,scratch=root.ownerDocument.createElement('canvas')
        try {
            const info = await document.getPageInfo(entry.index)
            if (closed || entry.controller.signal.aborted) return
            await document.renderPage(entry.index, scratch, {scale: maxSize===undefined?renderWidth/info.width:maxSize/Math.max(info.width,info.height), pixelRatio, signal: entry.controller.signal, priority: 'background'})
            if(closed||entry.controller.signal.aborted||entries.get(entry.canvas)!==entry||maxSize===undefined&&renderWidth!==entry.width)return
            entry.canvas.width=scratch.width;entry.canvas.height=scratch.height
            entry.canvas.getContext('2d')?.drawImage(scratch,0,0)
            remember(entry)
            entry.rendered = true
            entry.canvas.dataset.loaded = 'true'
        } catch (error) { if (!closed && !entry.controller.signal.aborted) { entry.rendered = true; onError?.(error) } }
        finally { document.releasePage(scratch);entry.controller = undefined; busy = false; if (!closed) void run() }
    }
    const observer = new IntersectionObserver(records => {
        for (const record of records) {
            const entry = entries.get(record.target as HTMLCanvasElement)
            if (!entry) continue
            entry.visible = record.isIntersecting
            if (!entry.visible && !entry.rendered) entry.controller?.abort()
        }
        void run()
    }, {root, rootMargin: '100px 0px'})
    const unobserve = (canvas: HTMLCanvasElement): void => {
        const entry = entries.get(canvas)
        if (!entry) return
        entry.controller?.abort(); observer.unobserve(canvas); entries.delete(canvas); document.releasePage(canvas)
    }
    return Object.freeze({
        sync(items: readonly {index: number; canvas: HTMLCanvasElement; width?:number}[]): void {
            if (closed) return
            if (items.length > 96) throw new RangeError('Thumbnail DOM window exceeds its limit')
            const retained = new Set(items.map(item => item.canvas))
            for (const canvas of entries.keys()) if (!retained.has(canvas)) unobserve(canvas)
            for (const {index, canvas, width:itemWidth=width} of items) {
                if (!Number.isSafeInteger(index) || index < 0 || index >= document.pageCount) throw new RangeError('Invalid thumbnail page index')
                const current = entries.get(canvas)
                if(!Number.isFinite(itemWidth)||itemWidth<16||itemWidth>512)throw new RangeError('Invalid thumbnail width')
                if(current?.index===index){
                    if(current.width!==itemWidth){current.width=itemWidth;if(maxSize===undefined){current.rendered=false;current.controller?.abort()}}
                    continue
                }
                if (current) unobserve(canvas)
                canvas.dataset.loaded = 'false'
                entries.set(canvas, {index, canvas, width:itemWidth, visible: false, rendered: false}); observer.observe(canvas)
            }
            void run()
        },
        destroy(): void { if (closed) return; closed = true; observer.disconnect(); for (const canvas of entries.keys()) unobserve(canvas) },
    })
}

export function thumbnailWindow(pageCount: number, scrollTop: number, viewportHeight: number, rowHeight = 240): {start: number; end: number; before: number; after: number} {
    if (!Number.isSafeInteger(pageCount) || pageCount < 0 || pageCount > 10000 || !Number.isFinite(scrollTop) || !Number.isFinite(viewportHeight) || !(rowHeight > 0) || !Number.isFinite(rowHeight)) throw new RangeError('Invalid thumbnail window')
    const visible = Math.min(24, Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 4)
    const start = Math.min(Math.max(0, pageCount - visible), Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - 2))
    const end = Math.min(pageCount, start + visible)
    return {start, end, before: start * rowHeight, after: (pageCount - end) * rowHeight}
}

/** Page-size metadata is measured on resize, never decoded while scrolling. */
export function thumbnailGridMetrics(pageCount:number,width:number,sizes?:readonly {width:number;height:number}[],compact=false,sidebarWidth=width){
    if(!Number.isSafeInteger(pageCount)||pageCount<0||pageCount>10000||!Number.isFinite(width))throw new RangeError('Invalid thumbnail grid')
    if(sizes&&(sizes.length!==pageCount||sizes.some(size=>![size.width,size.height].every(value=>Number.isFinite(value)&&value>0))))throw new RangeError('Invalid thumbnail dimensions')
    const edge=Math.min(Math.max(16,width-44),(sidebarWidth===300?250:Math.min(Math.floor(.7*sidebarWidth),250))*(compact?.55:1))
    const dimensions=(sizes??Array.from({length:pageCount},()=>({width:188,height:281}))).map(size=>{
        const scale=edge/Math.max(size.width,size.height)
        return {width:Math.max(1,Math.floor(size.width*scale)),height:Math.max(1,Math.floor(size.height*scale))}
    })
    const previewWidth=Math.max(1,...dimensions.map(size=>size.width)),previewHeight=Math.max(1,...dimensions.map(size=>size.height))
    const itemWidth=previewWidth+12,columns=Math.max(1,Math.min(8,Math.floor(Math.max(0,width)/(itemWidth+32))))
    return {pageCount,columns,itemWidth,previewWidth,previewHeight,dimensions,rowHeight:previewHeight+47}
}
export function thumbnailGridRange(metrics:ReturnType<typeof thumbnailGridMetrics>,scrollTop:number,viewportHeight:number){
    if(![scrollTop,viewportHeight].every(Number.isFinite))throw new RangeError('Invalid thumbnail viewport')
    const {pageCount,columns,rowHeight}=metrics,rows=Math.ceil(pageCount/columns)
    const visible=Math.min(Math.floor(96/columns),Math.ceil(Math.max(0,viewportHeight)/rowHeight)+4)
    const startRow=Math.min(Math.max(0,rows-visible),Math.max(0,Math.floor(Math.max(0,scrollTop-32)/rowHeight)-2)),endRow=Math.min(rows,startRow+visible)
    return {...metrics,start:startRow*columns,end:Math.min(pageCount,endRow*columns),before:startRow*rowHeight,after:(rows-endRow)*rowHeight}
}
/** Virtualize complete rows so widening a sidebar never loads the document list. */
export function thumbnailGridWindow(pageCount:number,scrollTop:number,viewportHeight:number,width:number,sizes?:readonly {width:number;height:number}[],compact=false) {
    return thumbnailGridRange(thumbnailGridMetrics(pageCount,width,sizes,compact),scrollTop,viewportHeight)
}
