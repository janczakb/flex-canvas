import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {PDFiumDocument} from '../dist/pdf/engine.js'
import {openPDF} from '../dist/pdf.js'

const require=createRequire(import.meta.url)
const wasm=fs.readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'))
const wasmUrl='data:application/wasm;base64,'+wasm.toString('base64')
const bytes=fs.readFileSync(new URL('../examples/assets/sample.pdf',import.meta.url))
const doc=await PDFiumDocument.open(bytes,wasmUrl)
let pixels=0
try{
    for(const index of [0,1,3]){
        const pageWidth=919,pageHeight=1189
        const full=new Uint8Array(doc.render(index,pageWidth,pageHeight).rgba)
        for(const [x,y,width,height] of [[0,0,384,384],[384,384,384,384],[768,768,151,384],[768,1152,151,37]]){
            const tile=new Uint8Array(doc.renderTile(index,{x,y,width,height,pageWidth,pageHeight}).rgba)
            for(let row=0;row<height;row++){
                const actual=tile.subarray(row*width*4,(row+1)*width*4)
                const expected=full.subarray(((y+row)*pageWidth+x)*4,((y+row)*pageWidth+x+width)*4)
                assert.deepEqual(actual,expected,'Clipped native render must equal the full-page pixels')
                pixels+=width
            }
        }
    }
    for(const tile of [
        {x:-1,y:0,width:10,height:10,pageWidth:100,pageHeight:100},
        {x:0,y:0,width:2048,height:10,pageWidth:4000,pageHeight:100},
        {x:98,y:0,width:10,height:10,pageWidth:100,pageHeight:100},
    ])assert.throws(()=>doc.renderTile(0,tile),e=>e.code==='pdf_render_limit')
}finally{doc.destroy()}

const originalWorker=globalThis.Worker
const submitted=[]
let instance
class WorkerProbe{
    constructor(){instance=this;this.held=[]}
    terminate(){this.closed=true}
    postMessage(request){
        submitted.push(request)
        if(request.method==='renderTile')this.held.push(request)
        else queueMicrotask(()=>this.reply(request,request.method==='open'?{pageCount:4,canEditPages:true}:request.method==='text'?{text:'ready',glyphs:[],truncated:false}:request.method==='info'?{pageIndex:request.input.index,width:612,height:792,rotation:0}:true))
    }
    reply(request,value){this.onmessage?.({data:{id:request.id,ok:true,value}})}
    release(){const request=this.held.shift();assert(request,'Expected native render in flight');this.reply(request,{width:1,height:1,rgba:new ArrayBuffer(4)})}
}
globalThis.Worker=WorkerProbe
let api
try{
    api=await openPDF({source:bytes,workerUrl:'/worker.js',wasmUrl:'/runtime.wasm'})
    await Promise.all(Array.from({length:10},()=>api.getPageInfo(0)))
    assert.equal(submitted.filter(request=>request.method==='info'&&request.input.index===0).length,1,'Concurrent geometry callers share one worker request')
    const tile={x:0,y:0,width:1,height:1,pageWidth:10,pageHeight:10}
    const first=api.renderTile(0,tile)
    const second=api.renderTile(1,tile)
    const abort=new AbortController()
    const discarded=api.renderTile(2,tile,abort.signal).then(()=>false,error=>error.name==='AbortError')
    const foreground=api.getText(3)
    abort.abort()
    assert(await discarded)
    instance.release()
    await first
    assert.equal(await foreground,'ready')
    await new Promise(resolve=>setImmediate(resolve))
    assert.deepEqual(submitted.filter(request=>['text','renderTile'].includes(request.method)).map(request=>request.input.index),[0,3,1])
    instance.release();await second
    const newestBlocker=api.renderTile(0,tile)
    const olderVisible=api.renderTile(1,tile,undefined,'foreground')
    const newestVisible=api.renderTile(3,tile,undefined,'foreground')
    instance.release();await newestBlocker;await new Promise(resolve=>setImmediate(resolve))
    assert.equal(instance.held[0].input.index,3,'Newest visible raster starts before an older visible raster')
    instance.release();await newestVisible;await new Promise(resolve=>setImmediate(resolve))
    assert.equal(instance.held[0].input.index,1,'Still-valid visible work is retained')
    instance.release();await olderVisible
    const scrollBlocker=api.renderTile(0,tile)
    const start=submitted.length;const oldScroll=[]
    for(let n=0;n<40;n++){
        const stop=new AbortController()
        oldScroll.push(api.renderTile(1,tile,stop.signal,'foreground').then(()=>false,error=>error.name==='AbortError'))
        stop.abort()
    }
    const currentScroll=api.renderTile(3,tile,undefined,'foreground')
    assert((await Promise.all(oldScroll)).every(Boolean),'All discarded viewport tasks settle with AbortError')
    instance.release();await scrollBlocker;await new Promise(resolve=>setImmediate(resolve))
    assert.deepEqual(submitted.slice(start).filter(request=>request.method==='renderTile').map(request=>request.input.index),[3],'Forty obsolete scroll tasks never reach the worker')
    instance.release();await currentScroll
    const blocker=api.renderTile(0,tile)
    const layerAbort=new AbortController(),layer={ownerDocument:{},replaceChildren(){}}
    const staleLayer=api.renderTextLayer(1,layer,1,layerAbort.signal)
    layerAbort.abort();api.clearTextLayer(layer)
    instance.release();await blocker;await staleLayer
    assert.equal(submitted.filter(request=>request.method==='text'&&request.input.index===1).length,0,'Removed page never schedules glyph extraction')
    const closing=api.renderTile(0,tile).then(()=>false,error=>error.name==='AbortError')
    await api.destroy();assert(await closing);assert(instance.closed)
}finally{await api?.destroy();globalThis.Worker=originalWorker}
console.log(JSON.stringify({nativeTilePixelsMatched:pixels,invalidTilesRejected:3,foregroundPriority:true,newestVisibleFirst:true,fortyObsoleteTasksNeverSubmitted:true,cancelledQueueRemoved:true,destroyCancelsWork:true}))

// The immutable source retains at most four native page handles across tile requests.
const source=await PDFiumDocument.open(bytes,wasmUrl)
const manyBytes=source.editPages(Array.from({length:12},(_,index)=>({index:index%4,rotation:0})),100,10485760)
source.destroy()
const many=await PDFiumDocument.open(new Uint8Array(manyBytes),wasmUrl)
const native=many.api,load=native.FPDF_LoadPage,close=native.FPDF_ClosePage
let loads=0,closes=0
native.FPDF_LoadPage=(...args)=>{loads++;return load(...args)}
native.FPDF_ClosePage=(...args)=>{closes++;return close(...args)}
try{
 for(let n=0;n<30;n++)many.renderTile(0,{x:0,y:0,width:64,height:64,pageWidth:612,pageHeight:792})
 assert.equal(loads,1,'Thirty same-page tiles reuse one native parse')
 for(let index=1;index<12;index++)many.info(index)
 assert.equal(loads,12);assert.equal(closes,8,'Only four handles remain after a long jump')
 many.info(0);assert.equal(loads,13,'Evicted page can be reopened')
 many.destroy();assert.equal(closes,loads,'Destroy closes every retained native handle')
}finally{many.destroy();native.FPDF_LoadPage=load;native.FPDF_ClosePage=close}
console.log(JSON.stringify({nativePageReuses:29,maxNativePages:4,allHandlesReleased:true}))
