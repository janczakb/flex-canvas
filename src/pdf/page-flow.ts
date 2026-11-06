import {createPDFSpreads,type PDFPageLayout} from './spread-layout.js'
import type {IndependentPDFDocument,PageInfo} from '../pdf.js'
import {createViewerZoom,type ViewerZoom} from './zoom.js'
import {createPDFTileSurface,createPDFTileCache} from './tile-surface.js'

export type PDFScrollMode='paginated'|'continuous'
export interface PDFPageScene {
    index:number;stage:HTMLDivElement;source:HTMLCanvasElement;text:HTMLDivElement;overlay:HTMLCanvasElement;links:HTMLDivElement;tiles:HTMLDivElement
    width:number;height:number;scale:number
}
interface FlowOptions {
    document:IndependentPDFDocument;viewport:HTMLElement;signal:AbortSignal
    paint(scene:PDFPageScene):void;activate(scene:PDFPageScene):void;current():number
    zoom?:ViewerZoom
    pageLayout?:PDFPageLayout;firstPageSingle?:boolean;scrollMode?:PDFScrollMode
    pinned():boolean;error(error:unknown):void
}
/** Page geometry is cheap; decoded page surfaces are a bounded viewport window. */
export async function createPDFPageFlow(options:FlowOptions){
    const {document:pdf,viewport,signal}=options,owner=viewport.ownerDocument,view=owner.defaultView!
    const holder=owner.createElement('div');holder.className='fm-flow'
    const first=await pdf.getPageInfo(0)
    const dimensions=pdf.getPageSizes?await pdf.getPageSizes():undefined
    signal.throwIfAborted()
    const infos=new Map<number,PageInfo>([[0,first]]),tops:number[]=[],heights:number[]=[],lefts:number[]=[],rowTops:number[]=[],rowHeights:number[]=[]
    let spreadPlan=createPDFSpreads([],options.pageLayout??'single',options.firstPageSingle??true)
    const paginated=options.scrollMode==='paginated'
    dimensions?.forEach((size,pageIndex)=>infos.set(pageIndex,{...size,pageIndex,rotation:0}))
    const pages=new Map<number,{scene:PDFPageScene;controller:AbortController;surface:ReturnType<typeof createPDFTileSurface>;ready:boolean;key:string}>()
    const cache=createPDFTileCache(),gap=24,maxMounted=8,zoomState=options.zoom??createViewerZoom()
    let width=0,height=0,fitScale=1,reference=options.current(),zoomKey='',frame=0,disposed=false,revision=0,rendering=false,pending=false,scrollRevision=0,previewing=false
    const waiters:Array<{resolve:()=>void;reject:(error:unknown)=>void}>=[]
    viewport.append(holder)
    function geometry(){
        const available=Math.max(24,viewport.clientWidth-48)
        width=available;height=Math.max(24,viewport.clientHeight-48)
        spreadPlan=createPDFSpreads(Array.from({length:pdf.pageCount},(_,index)=>infos.get(index)??first),options.pageLayout??'single',options.firstPageSingle??true)
        const referenceRow=spreadPlan.pageRows[reference],current=spreadPlan.spreads[referenceRow]
        const maximumWidth=paginated?current.width:Math.max(...spreadPlan.spreads.map(row=>row.width))
        const fitWidth=available/maximumWidth
        fitScale=zoomState.resolve(Math.min(fitWidth,height/current.height),fitWidth)
        const contentWidth=Math.max(viewport.clientWidth,maximumWidth*fitScale+48)
        let y=gap
        spreadPlan.spreads.forEach((row,rowIndex)=>{
            rowTops[rowIndex]=paginated?Math.max(gap,(viewport.clientHeight-row.height*fitScale)/2):y;rowHeights[rowIndex]=row.height*fitScale
            let x=Math.max(24,(contentWidth-row.width*fitScale)/2)
            for(const index of row.pages){
                const info=infos.get(index)??first
                tops[index]=rowTops[rowIndex]+(row.height-info.height)*fitScale/2
                heights[index]=info.height*fitScale;lefts[index]=x;x+=info.width*fitScale
            }
            y+=rowHeights[rowIndex]+gap
        })
        holder.style.height=(paginated?Math.max(viewport.clientHeight,current.height*fitScale+48):y)+'px'
        holder.style.width=contentWidth+'px'
    }
    function rowAt(y:number){
        if(paginated)return spreadPlan.pageRows[reference]
        let low=0,high=spreadPlan.spreads.length-1
        while(low<high){const middle=Math.floor((low+high+1)/2);if(rowTops[middle]<=y)low=middle;else high=middle-1}
        return low
    }
    function indexAt(y:number){return spreadPlan.spreads[rowAt(y)].pages[0]}
    function release(index:number){
        const item=pages.get(index);if(!item)return
        item.controller.abort();pdf.clearTextLayer(item.scene.text);pdf.releasePage(item.scene.source)
        item.surface.hide();item.scene.overlay.width=item.scene.overlay.height=1;item.scene.stage.remove();pages.delete(index)
    }
    function create(index:number){
        const make=<K extends keyof HTMLElementTagNameMap>(tag:K,cls:string)=>{const node=owner.createElement(tag);node.className=cls;return node}
        const stage=make('div','fm-stage fm-flow-page'),source=make('canvas','fm-page-source'),tiles=make('div','fm-pdf-tiles'),text=make('div','fm-text'),overlay=make('canvas','fm-page-overlay'),links=make('div','fm-links')
        stage.dataset.pageIndex=String(index);stage.setAttribute('role','group')
        stage.append(source,tiles,text,overlay,links)
        const next=[...pages.values()].filter(item=>item.scene.index>index).sort((a,b)=>a.scene.index-b.scene.index)[0]?.scene.stage
        holder.insertBefore(stage,next??null)
        const controller=new AbortController(),scene={index,stage,source,text,overlay,links,tiles,width:1,height:1,scale:1}
        const surface=createPDFTileSurface(tiles,viewport,controller.signal,options.error,cache)
        const item={scene,controller,surface,ready:false,key:''};pages.set(index,item);return item
    }
    function position(item:ReturnType<typeof create>){
        const {scene}=item,info=infos.get(scene.index)??first
        scene.scale=fitScale;scene.width=info.width*scene.scale;scene.height=info.height*scene.scale
        scene.stage.style.cssText=`top:${tops[scene.index]}px;left:${lefts[scene.index]}px;width:${scene.width}px;height:${scene.height}px;`
    }
    async function render(item:ReturnType<typeof create>){
        const {scene,controller}=item,index=scene.index,version=revision
        const info=await pdf.getPageInfo(index)
        if(disposed||controller.signal.aborted)return
        if(!infos.has(index)){
            const anchor=indexAt(viewport.scrollTop),offset=viewport.scrollTop-tops[anchor]
            infos.set(index,info);geometry();for(const mounted of pages.values())position(mounted)
            viewport.scrollTop=tops[anchor]+offset
        }
        position(item)
        const key=scene.scale+':'+(view.devicePixelRatio||1)
        if(key===item.key)return
        if(!item.ready)scene.stage.dataset.loading='true'
        const inView=tops[index]<viewport.scrollTop+viewport.clientHeight&&tops[index]+heights[index]>viewport.scrollTop
        const scratch=owner.createElement('canvas')
        try{
            await pdf.renderPage(index,scratch,{scale:scene.scale,pixelRatio:Math.min(1,640/Math.max(scene.width,scene.height)),signal:controller.signal,priority:inView?'foreground':'background'})
            if(disposed||controller.signal.aborted||version!==revision)return
            scene.source.width=scratch.width;scene.source.height=scratch.height
            scene.source.getContext('2d')?.drawImage(scratch,0,0)
        }finally{pdf.releasePage(scratch)}
        await pdf.renderTextLayer(index,scene.text,scene.scale)
        if(disposed||controller.signal.aborted||version!==revision)return
        const ratio=Math.min(view.devicePixelRatio||1,2048/scene.width,2048/scene.height,Math.sqrt(1048576/(scene.width*scene.height)))
        scene.overlay.width=Math.max(1,Math.round(scene.width*ratio));scene.overlay.height=Math.max(1,Math.round(scene.height*ratio))
        scene.stage.removeAttribute('data-loading');item.ready=true;item.key=key
        item.surface.show({document:pdf,index,width:scene.width,height:scene.height,dpr:Math.min(4,view.devicePixelRatio||1)})
        options.paint(scene)
        if(index===options.current())options.activate(scene)
    }
    async function draw(){
        if(disposed||previewing)return
        if(rendering){pending=true;return new Promise<void>((resolve,reject)=>waiters.push({resolve,reject}))}
        rendering=true
        const scrollVersion=scrollRevision
        try{
            const top=viewport.scrollTop,bottom=top+viewport.clientHeight
            const firstRow=paginated?spreadPlan.pageRows[reference]:Math.max(0,rowAt(top)-1)
            const lastRow=paginated?firstRow:Math.min(spreadPlan.spreads.length-1,rowAt(bottom)+1)
            const wanted=new Set<number>()
            // Keep active pointer/text surfaces attached until their gesture finishes.
            if(options.pinned())for(const index of pages.keys())wanted.add(index)
            for(let row=firstRow;row<=lastRow&&wanted.size<maxMounted;row++)for(const index of spreadPlan.spreads[row].pages)if(wanted.size<maxMounted)wanted.add(index)
            for(const index of pages.keys())if(!wanted.has(index))release(index)
            const visible=(index:number)=>tops[index]<bottom&&tops[index]+heights[index]>top
            const order=[...wanted].sort((a,b)=>Number(visible(b))-Number(visible(a))||Math.abs(tops[a]+heights[a]/2-(top+bottom)/2)-Math.abs(tops[b]+heights[b]/2-(top+bottom)/2))
            for(const index of order){
                if(disposed)break
                if(scrollVersion!==scrollRevision){pending=true;break}
                const item=pages.get(index)??create(index)
                await render(item)
            }
            if(!options.pinned()){
                const index=paginated?reference:indexAt(viewport.scrollTop+Math.min(viewport.clientHeight*.35,200)),item=pages.get(index)
                if(item?.ready)options.activate(item.scene)
            }
        }catch(error){if(!disposed&&(error as Error)?.name!=='AbortError'){for(const waiter of waiters.splice(0))waiter.reject(error);throw error}}
        finally{rendering=false;if(pending&&!disposed){pending=false;request()}else for(const waiter of waiters.splice(0))waiter.resolve()}
    }
    function request(){if(!disposed&&!frame)frame=view.requestAnimationFrame(()=>{frame=0;void draw().catch(options.error)})}
    function destroy(){
        if(disposed)return
        disposed=true;view.cancelAnimationFrame(frame);viewport.removeEventListener('scroll',onScroll)
        signal.removeEventListener('abort',destroy)
        for(const index of pages.keys())release(index)
        cache.clear();holder.remove();for(const waiter of waiters.splice(0))waiter.resolve()
    }
    function onScroll(){
        scrollRevision++
        if(!options.pinned())for(const index of pages.keys())if(tops[index]+heights[index]<viewport.scrollTop-viewport.clientHeight||tops[index]>viewport.scrollTop+viewport.clientHeight*2)release(index)
        request()
    }
    viewport.addEventListener('scroll',onScroll,{passive:true});signal.addEventListener('abort',destroy,{once:true})
    geometry()
    return {
        async update(previewOnly=false){
            if(disposed)return
            previewing=previewOnly
            const anchor=indexAt(viewport.scrollTop),fraction=(viewport.scrollTop-tops[anchor])/heights[anchor]
            if(zoomKey!==zoomState.mode+':'+zoomState.level||width!==Math.max(24,viewport.clientWidth-48)||height!==Math.max(24,viewport.clientHeight-48)){
                revision++;zoomKey=zoomState.mode+':'+zoomState.level;geometry()
                for(const item of pages.values())position(item)
                viewport.scrollTop=tops[anchor]+fraction*heights[anchor]
            }
            if(previewOnly)return
            await draw()
        },
        async goTo(index:number){
            if(disposed)return
            if(reference!==index){reference=index;revision++;geometry();for(const item of pages.values())position(item)}
            viewport.scrollTop=paginated?0:Math.max(0,rowTops[spreadPlan.pageRows[index]]-gap);await draw()
            const item=pages.get(index);if(item?.ready)options.activate(item.scene)
        },
        sceneFor(target:Element){const node=target.closest<HTMLElement>('.fm-flow-page');return node?pages.get(Number(node.dataset.pageIndex))?.scene:undefined},
        scenes:()=>[...pages.values()].filter(item=>item.ready).map(item=>item.scene),
        refresh(){for(const item of pages.values())if(item.ready)options.paint(item.scene)},
        destroy,
    }
}
