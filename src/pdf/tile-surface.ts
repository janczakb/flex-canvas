import type { IndependentPDFDocument, PDFTile } from '../pdf.js'

const tileSize = 384
const cacheBytes = 24 * 1024 * 1024
const maxViewportTiles = 64

type CanvasTile = {key:string; area:PDFTile; canvas:HTMLCanvasElement; visible:boolean; distance:number}
type SurfacePage = {document:IndependentPDFDocument; index:number; width:number; height:number; dpr:number}
type CachedTile = {width:number;height:number;rgba:ArrayBuffer}

/** One byte-bounded LRU across all visible PDF pages. */
export function createPDFTileCache(){
    const entries=new Map<string,CachedTile>();let used=0
    return {
        get(key:string){const value=entries.get(key);if(value){entries.delete(key);entries.set(key,value)}return value},
        set(key:string,raster:CachedTile){
            const previous=entries.get(key);if(previous)used-=previous.rgba.byteLength
            entries.delete(key);entries.set(key,raster);used+=raster.rgba.byteLength
            while(used>cacheBytes&&entries.size){const first=entries.keys().next().value!;used-=entries.get(first)!.rgba.byteLength;entries.delete(first)}
        },
        clear(){entries.clear();used=0},
    }
}

export function createPDFTileSurface(layer: HTMLElement, viewport: HTMLElement, signal: AbortSignal, onError: (error:unknown)=>void,sharedCache?:ReturnType<typeof createPDFTileCache>) {
    const owner = layer.ownerDocument, view = owner.defaultView!
    const cache = sharedCache??createPDFTileCache(), tiles = new Map<string,CanvasTile>()
    let frame = 0, epoch = 0
    let page:SurfacePage|undefined, active: {key:string; controller:AbortController}|undefined

    function paint(tile:CanvasTile,raster:CachedTile) {
        const {canvas}=tile
        canvas.width=raster.width;canvas.height=raster.height
        canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(raster.rgba),raster.width,raster.height),0,0)
        canvas.dataset.loaded='true'
    }
    function draw() {
        if(!page||signal.aborted)return
        const bounds=layer.getBoundingClientRect(),window=viewport.getBoundingClientRect()
        const ratio=Math.min(page.dpr,65536/page.width,65536/page.height)
        const fullWidth=Math.max(1,Math.min(65536,Math.ceil(page.width*ratio))),fullHeight=Math.max(1,Math.min(65536,Math.ceil(page.height*ratio)))
        const left=Math.max(0,Math.min(fullWidth,(window.left-bounds.left)*ratio))
        const top=Math.max(0,Math.min(fullHeight,(window.top-bounds.top)*ratio))
        const right=Math.max(0,Math.min(fullWidth,(window.right-bounds.left)*ratio))
        const bottom=Math.max(0,Math.min(fullHeight,(window.bottom-bounds.top)*ratio))
        const startX=Math.max(0,Math.floor(left/tileSize)-1),endX=Math.min(Math.ceil(fullWidth/tileSize),Math.ceil(right/tileSize)+1)
        const startY=Math.max(0,Math.floor(top/tileSize)-1),endY=Math.min(Math.ceil(fullHeight/tileSize),Math.ceil(bottom/tileSize)+1)
        const wanted:Array<Omit<CanvasTile,'canvas'>>=[]
        for(let row=startY;row<endY;row++)for(let col=startX;col<endX;col++){
            const x=col*tileSize,y=row*tileSize,width=Math.min(tileSize,fullWidth-x),height=Math.min(tileSize,fullHeight-y)
            wanted.push({key:[page.index,fullWidth,fullHeight,col,row].join(':'),area:{x,y,width,height,pageWidth:fullWidth,pageHeight:fullHeight},
                visible:x<right&&x+width>left&&y<bottom&&y+height>top,
                distance:Math.hypot(x+width/2-(left+right)/2,y+height/2-(top+bottom)/2)})
        }
        const visible=wanted.sort((a,b)=>Number(b.visible)-Number(a.visible)||a.distance-b.distance).slice(0,maxViewportTiles)
        const keys=new Set(visible.map(tile=>tile.key))
        for(const [key,tile] of tiles)if(!keys.has(key)){
            tile.canvas.remove();tile.canvas.width=tile.canvas.height=1;tiles.delete(key)
        }
        if(active&&!keys.has(active.key))active.controller.abort()
        for(const item of visible){
            const existing=tiles.get(item.key)
            if(existing){existing.visible=item.visible;existing.distance=item.distance;continue}
            const canvas=owner.createElement('canvas'),{x,y,width,height}=item.area
            canvas.style.cssText='left:'+x/fullWidth*100+'%;top:'+y/fullHeight*100+'%;width:'+width/fullWidth*100+'%;height:'+height/fullHeight*100+'%'
            canvas.width=canvas.height=1
            const tile={...item,canvas};tiles.set(item.key,tile);layer.append(canvas)
            const raster=cache.get(item.key)
            if(raster){paint(tile,raster)}
        }
        run()
    }
    function run() {
        if(active||signal.aborted||!page)return
        const tile=[...tiles.values()].filter(item=>!item.canvas.dataset.loaded)
            .sort((a,b)=>Number(b.visible)-Number(a.visible)||a.distance-b.distance)[0]
        if(!tile)return
        const current=page,version=epoch,controller=new AbortController()
        active={key:tile.key,controller}
        void current.document.renderTile(current.index,tile.area,controller.signal,tile.visible?'foreground':'background').then(raster=>{
            if(signal.aborted||controller.signal.aborted||version!==epoch||tiles.get(tile.key)!==tile)return
            cache.set(tile.key,raster);paint(tile,raster)
        }).catch(error=>{
            if(!controller.signal.aborted&&!signal.aborted&&version===epoch){tile.canvas.dataset.loaded='error';onError(error)}
        }).finally(()=>{active=undefined;run()})
    }
    function request() {
        if(!frame)frame=view.requestAnimationFrame(()=>{frame=0;draw()})
    }
    function hide() {
        epoch++;active?.controller.abort();page=undefined
        for(const {canvas} of tiles.values())canvas.width=canvas.height=1
        tiles.clear();layer.replaceChildren()
    }
    function reset() {hide();if(!sharedCache)cache.clear()}
    function destroy() {
        reset();view.cancelAnimationFrame(frame);viewport.removeEventListener('scroll',request);signal.removeEventListener('abort',destroy)
    }
    signal.addEventListener('abort',destroy,{once:true})
    viewport.addEventListener('scroll',request,{passive:true})
    return {
        show(next:SurfacePage){
            if(page&&page.document!==next.document)reset()
            if(page&&(page.index!==next.index||page.width!==next.width||page.height!==next.height||page.dpr!==next.dpr)){
                epoch++;active?.controller.abort()
            }
            page=next;request()
        },
        hide,reset,
    }
}
