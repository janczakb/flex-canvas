import {openPDF,type PDFOptions,type SearchHit} from './pdf.js'
import {createPDFPageFlow,type PDFPageScene} from './pdf/page-flow.js'
import {createViewerZoom} from './pdf/zoom.js'
import type {ViewerPrintOptions} from './printing.js'

export interface PDFReaderState {pageIndex:number;pageCount:number;scale:number;fit:boolean}
export interface PDFSearchState {index:number;total:number;pending:boolean;scannedPages:number;totalPages:number;limited:boolean}
export interface PDFReaderPrintOptions extends ViewerPrintOptions {title?:string;assetBaseUrl?:string|URL;onProgress?:(done:number,total:number)=>void;label?:(key:string)=>string}
export interface PDFReaderOptions extends PDFOptions {
    onChange?:(state:PDFReaderState)=>void
    onSearchChange?:(state:PDFSearchState)=>void
    onError?:(error:unknown)=>void
}
/** No built-in chrome: applications own their controls, progress and search surfaces. */
export async function mountPDFReader(container:HTMLElement,options:PDFReaderOptions){
    const controller=new AbortController(),signal=controller.signal
    const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true})
    if(options.signal?.aborted)abort()
    const viewport=container.ownerDocument.createElement('div');viewport.className='fm-reader-viewport'
    viewport.tabIndex=0;viewport.setAttribute('role','document');container.append(viewport)
    let flow:Awaited<ReturnType<typeof createPDFPageFlow>>|undefined
    let pdf:Awaited<ReturnType<typeof openPDF>>|undefined
    let observer:ResizeObserver|undefined,frame=0,closed=false,searchAbort:AbortController|undefined
    const view=container.ownerDocument.defaultView!,zoom=createViewerZoom({mode:'fit-width'})
    let state:PDFReaderState={pageIndex:0,pageCount:0,scale:1,fit:true}
    let searchState:PDFSearchState={index:0,total:0,pending:false,scannedPages:0,totalPages:0,limited:false}
    let hits:SearchHit[]=[]
    const byPage=new Map<number,Array<{hit:SearchHit;index:number}>>()
    const report=()=>options.onChange?.({...state,fit:zoom.mode!=='custom'})
    const reportSearch=()=>options.onSearchChange?.({...searchState})
    const check=()=>signal.throwIfAborted()
    const paint=(scene:PDFPageScene)=>{
        const fragment=container.ownerDocument.createDocumentFragment()
        for(const {hit,index} of byPage.get(scene.index)??[])for(const rect of hit.rectangles){
            const mark=container.ownerDocument.createElement('mark');mark.className='fm-reader-search-hit'
            mark.style.cssText=`position:absolute;left:${rect.x*100}%;top:${rect.y*100}%;width:${rect.width*100}%;height:${rect.height*100}%;background:${index===searchState.index-1?'#ff880099':'#ffe60066'};pointer-events:none;`
            fragment.append(mark)
        }
        scene.links.replaceChildren(fragment)
    }
    const destroy=()=>{
        if(closed)return
        closed=true;searchAbort?.abort();controller.abort();options.signal?.removeEventListener('abort',abort)
        observer?.disconnect();view.cancelAnimationFrame(frame);flow?.destroy();void pdf?.destroy();viewport.remove();hits=[];byPage.clear()
    }
    signal.addEventListener('abort',destroy,{once:true})
    const fail=(error:unknown)=>{if(!signal.aborted)options.onError?.(error)}
    const selectSearchResult=async(index:number)=>{
        check();if(!Number.isSafeInteger(index)||index<0||index>=hits.length)throw new RangeError('Invalid PDF search result')
        searchState.index=index+1;reportSearch();await flow?.goTo(hits[index].pageIndex);flow?.refresh()
        const scene=flow?.scenes().find(scene=>scene.index===hits[index].pageIndex),rect=hits[index].rectangles[0]
        if(scene&&rect)viewport.scrollTop=Math.max(0,scene.stage.offsetTop+rect.y*scene.height-viewport.clientHeight/3)
    }
    try{
        pdf=await openPDF({...options,signal});check()
        state.pageCount=pdf.pageCount;searchState.totalPages=pdf.pageCount
        flow=await createPDFPageFlow({document:pdf,viewport,signal,zoom,overlay:false,
            onPageProgress:(pageIndex,ready)=>options.onProgress?.({phase:'render',pageIndex,loaded:ready?1:0,total:1}),
            current:()=>state.pageIndex,pinned:()=>false,paint,error:fail,
            activate:scene=>{state={pageIndex:scene.index,pageCount:pdf!.pageCount,scale:scene.scale,fit:zoom.mode!=='custom'};report()},
        })
        check();await flow.update();check()
        options.onProgress?.({phase:'ready',loaded:1,total:1,pageIndex:state.pageIndex})
        observer=new ResizeObserver(()=>{if(!frame)frame=view.requestAnimationFrame(()=>{frame=0;void flow?.update().catch(fail)})})
        observer.observe(viewport)
        return {
            element:viewport,getState:()=>({...state}),getSearchState:()=>({...searchState}),
            async setPage(index:number){check();if(!Number.isSafeInteger(index)||index<0||index>=state.pageCount)throw new RangeError('Invalid PDF page');await flow?.goTo(index)},
            async setZoom(value:number|'fit-width'|'fit-page'){check();zoom.set(value);await flow?.update()},
            async search(query:string,{matchCase=false,wholeWord=false,limit=1000,signal:searchSignal}:{matchCase?:boolean;wholeWord?:boolean;limit?:number;signal?:AbortSignal}={}){
                check();if(typeof query!=='string'||query.length>1024||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new RangeError('Invalid PDF search')
                searchAbort?.abort();const task=new AbortController();searchAbort=task
                const stop=()=>task.abort();signal.addEventListener('abort',stop,{once:true});searchSignal?.addEventListener('abort',stop,{once:true})
                if(searchSignal?.aborted)stop()
                hits=[];byPage.clear();searchState={index:0,total:0,pending:!!query,scannedPages:0,totalPages:pdf!.pageCount,limited:false};reportSearch();flow?.refresh()
                try{
                    if(!query)return []
                    const found:SearchHit[]=[],first=state.pageIndex
                    for(let offset=0;offset<pdf!.pageCount&&found.length<limit;offset++){
                        task.signal.throwIfAborted()
                        const page=(first+offset)%pdf!.pageCount
                        found.push(...await pdf!.searchPage(page,query,{matchCase,wholeWord,limit:Math.min(100,limit-found.length),signal:task.signal}))
                        task.signal.throwIfAborted();searchState.scannedPages++;searchState.total=found.length;reportSearch()
                    }
                    task.signal.throwIfAborted();hits=found
                    hits.forEach((hit,index)=>{let group=byPage.get(hit.pageIndex);if(!group)byPage.set(hit.pageIndex,group=[]);group.push({hit,index})})
                    searchState.pending=false;searchState.limited=found.length>=limit;reportSearch()
                    if(hits.length)await selectSearchResult(0);else flow?.refresh()
                    return hits.map(hit=>({...hit,rectangles:hit.rectangles.map(rect=>({...rect}))}))
                }finally{
                    signal.removeEventListener('abort',stop);searchSignal?.removeEventListener('abort',stop)
                    if(searchAbort===task){searchState.pending=false;reportSearch()}
                }
            },
            selectSearchResult,
            async nextSearchResult(direction:1|-1=1){check();if(direction!==1&&direction!==-1)throw new RangeError('Invalid search direction');if(hits.length)await selectSearchResult((searchState.index-1+direction+hits.length)%hits.length);return {...searchState}},
            async print(settings:PDFReaderPrintOptions={}){
                check();const {printMedia}=await import('./printing.js');check()
                const labels:Record<string,string>={print_in_progress:'Printing is already in progress',print_too_large:'Document exceeds the print budget',print_preparing:'Preparing print',print_progress:'{done} of {total}',loading_document:'Loading document',cancel:'Cancel'}
                return printMedia({owner:viewport,signal,showProgress:false,label:settings.label??(key=>labels[key]??key),title:settings.title??'Document',assetBaseUrl:settings.assetBaseUrl,settings,onProgress:settings.onProgress,
                    pages:()=>pdf!.getPageSizes(),render:async(index,canvas,scale,printSignal)=>{await pdf!.renderPage(index,canvas,{scale,pixelRatio:1,signal:printSignal})},
                })
            },
            destroy,
        }
    }catch(error){destroy();throw error}
}
