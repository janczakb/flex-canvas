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
        else queueMicrotask(()=>this.reply(request,request.method==='open'?{pageCount:4,canEditPages:true}:request.method==='text'?{text:'ready',glyphs:[],truncated:false}:true))
    }
    reply(request,value){this.onmessage?.({data:{id:request.id,ok:true,value}})}
    release(){const request=this.held.shift();assert(request,'Expected native render in flight');this.reply(request,{width:1,height:1,rgba:new ArrayBuffer(4)})}
}
globalThis.Worker=WorkerProbe
let api
try{
    api=await openPDF({source:bytes,workerUrl:'/worker.js',wasmUrl:'/runtime.wasm'})
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
    const closing=api.renderTile(0,tile).then(()=>false,error=>error.name==='AbortError')
    await api.destroy();assert(await closing);assert(instance.closed)
}finally{await api?.destroy();globalThis.Worker=originalWorker}
console.log(JSON.stringify({nativeTilePixelsMatched:pixels,invalidTilesRejected:3,foregroundPriority:true,cancelledQueueRemoved:true,destroyCancelsWork:true}))
