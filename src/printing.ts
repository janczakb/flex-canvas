import {openPrintProgress} from './print-dialog.js'

export interface ViewerPrintOptions {
    /** Requested dots per inch. Memory budgets can lower it for large documents. */
    dpi?:number
    maxPagePixels?:number
    maxTotalPixels?:number
    maxBytes?:number
}
const activePrints=new WeakSet<Document>()

interface PageSize {width:number;height:number}
interface PrintOptions {
    owner:HTMLElement;signal:AbortSignal;label:(key:string)=>string;title:string
    assetBaseUrl?:string|URL;settings?:ViewerPrintOptions
    pages:()=>Promise<readonly PageSize[]>
    render:(index:number,canvas:HTMLCanvasElement,scale:number,signal:AbortSignal)=>Promise<void>
}

/** Prepare all printable pages before invoking the native dialog, without a PDF browser plug-in. */
export async function printMedia(options:PrintOptions):Promise<boolean> {
    const {owner,signal,label}=options,doc=owner.ownerDocument,view=doc.defaultView!,controller=new AbortController()
    const settings={dpi:144,maxPagePixels:4194304,maxTotalPixels:67108864,maxBytes:134217728,...options.settings}
    for(const [key,min,max] of [['dpi',72,300],['maxPagePixels',262144,16777216],['maxTotalPixels',1048576,268435456],['maxBytes',1048576,268435456]] as const){
        const value=settings[key];if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError('Invalid print limits')
    }
    if(signal.aborted)return false
    if(activePrints.has(doc))throw new Error(label('print_in_progress'))
    activePrints.add(doc)
    const originalTitle=doc.title
    const abort=()=>controller.abort(),urls:string[]=[],canvas=doc.createElement('canvas')
    let printRoot:HTMLDivElement|undefined,sheet:HTMLLinkElement|undefined,printed=false,disposed=false,progress:ReturnType<typeof openPrintProgress>|undefined
    let finish:()=>void=()=>{}
    const done=new Promise<void>(resolve=>{finish=resolve})
    const clear=()=>{
        if(disposed)return;disposed=true;signal.removeEventListener('abort',abort)
        controller.signal.removeEventListener('abort',clear);view.removeEventListener('afterprint',clear)
        activePrints.delete(doc);doc.title=originalTitle;doc.documentElement.classList.remove('fm-printing');printRoot?.remove();sheet?.remove();for(const url of urls)URL.revokeObjectURL(url)
        canvas.width=canvas.height=1;progress?.destroy();finish()
    }
    signal.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',clear,{once:true})
    try{
        progress=openPrintProgress(owner,label,abort)
        // The UI is mounted before any worker preparation starts.
        const pages=await options.pages();controller.signal.throwIfAborted()
        if(!pages.length||pages.some(page=>![page.width,page.height].every(value=>Number.isFinite(value)&&value>0)))throw new Error('Invalid print pages')
        progress.update(0,pages.length)
        const area=pages.reduce((sum,page)=>sum+page.width*page.height,0)
        const scale=Math.min(settings.dpi/72,Math.sqrt(settings.maxTotalPixels/area),...pages.map(page=>Math.sqrt(settings.maxPagePixels/(page.width*page.height))))
        if(scale<.5)throw new Error(label('print_too_large'))
        printRoot=doc.createElement('div');printRoot.className='fm-print-document'
        printRoot.setAttribute('aria-hidden','true');doc.body.append(printRoot)
        const printDoc=doc,printWindow=view
        sheet=printDoc.createElement('link');sheet.rel='stylesheet';sheet.crossOrigin='anonymous';sheet.dataset.fmPrint=''
        const base=options.assetBaseUrl?new URL(String(options.assetBaseUrl),doc.baseURI):new URL('./',import.meta.url)
        sheet.href=new URL('print.css',String(base).replace(/\/?$/,'/')).href
        await new Promise<void>((resolve,reject)=>{
            const cleanup=()=>{controller.signal.removeEventListener('abort',cancel);sheet!.onload=sheet!.onerror=null}
            const cancel=()=>{cleanup();reject(new DOMException('Aborted','AbortError'))}
            sheet!.onload=()=>{cleanup();resolve()};sheet!.onerror=()=>{cleanup();reject(new Error('Print stylesheet unavailable'))}
            controller.signal.addEventListener('abort',cancel,{once:true});printDoc.head.append(sheet!)
        })
        controller.signal.throwIfAborted()
        const orientations=new Set(pages.map(page=>page.width>page.height?'landscape':'portrait'))
        if(orientations.size===1)sheet!.sheet!.insertRule(`@page {size:${[...orientations][0]};margin:0}`,sheet!.sheet!.cssRules.length)
        let bytes=0
        for(let index=0;index<pages.length;index++){
            controller.signal.throwIfAborted()
            const page=pages[index]
            await options.render(index,canvas,scale,controller.signal);controller.signal.throwIfAborted()
            const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Print image unavailable')),'image/png'))
            controller.signal.throwIfAborted();bytes+=blob.size
            if(bytes>settings.maxBytes)throw new Error(label('print_too_large'))
            const url=URL.createObjectURL(blob);urls.push(url)
            const section=printDoc.createElement('section'),image=printDoc.createElement('img')
            section.className='fm-print-page'
            image.alt='';image.src=url;section.append(image);printRoot.append(section)
            await image.decode();controller.signal.throwIfAborted()
            canvas.width=canvas.height=1;progress.update(index+1,pages.length)
        }
        await progress.close();controller.signal.throwIfAborted()
        // One actual layout pass after image decoding and modal exit, not a readiness timeout.
        await new Promise<void>(resolve=>view.requestAnimationFrame(()=>resolve()))
        controller.signal.throwIfAborted()
        doc.title=options.title;doc.documentElement.classList.add('fm-printing')
        printWindow.addEventListener('afterprint',clear,{once:true})
        printWindow.focus();printWindow.print();printed=true
        await done
        return true
    }catch(error){
        if(controller.signal.aborted)return false
        throw error
    }finally{if(!printed||signal.aborted)clear()}
}
