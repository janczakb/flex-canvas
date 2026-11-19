import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {chromium} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
import {PDFiumDocument} from '../dist/pdf/engine.js'
const require=createRequire(import.meta.url),wasm='data:application/wasm;base64,'+fs.readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')).toString('base64')
const source=await PDFiumDocument.open(fs.readFileSync('examples/assets/sample.pdf'),wasm)
const bytes=source.editPages(Array.from({length:1000},(_,index)=>({index:index%4,rotation:0})),1000,104857600)
source.destroy()
const example=await serveViewerExample(),browser=await chromium.launch()
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/large.pdf',route=>route.fulfill({body:Buffer.from(bytes),contentType:'application/pdf',headers:{'content-length':String(bytes.byteLength)}}))
 await page.goto(example.url)
 const result=await page.evaluate(async()=>{
  const {mountPDFReader}=await import('/dist/browser/reader.js')
  const style=document.createElement('style');style.textContent='.fm-reader-viewport{position:relative;width:100%;height:100%;overflow:auto}.fm-flow{position:relative}.fm-flow-page{position:absolute}.fm-flow-page>*{position:absolute;inset:0;width:100%;height:100%}.fm-pdf-tiles canvas{position:absolute}'
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:white';document.head.append(style);document.body.append(host)
  const controller=new AbortController(),start=performance.now();let workers=0
  const WorkerOriginal=window.Worker;window.Worker=class extends WorkerOriginal{constructor(...args){super(...args);workers++}terminate(){workers--;super.terminate()}}
  const reader=await mountPDFReader(host,{source:'/large.pdf',workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm',signal:controller.signal})
  const openedMs=performance.now()-start,initial={state:reader.getState(),mounted:host.querySelectorAll('.fm-flow-page').length,textLayers:[...host.querySelectorAll('.fm-text')].filter(node=>node.children.length).length}
  // Real wheel/scroll activity must defer glyph DOM until the 180ms settle period.
  const scrolling=reader.element
  const settle=()=>new Promise(resolve=>setTimeout(resolve,40))
  for(let i=1;i<=6;i++){scrolling.scrollTop=i*120;await settle()}
  const duringScrollText=[...host.querySelectorAll('.fm-text')].filter(node=>node.children.length).length
  await new Promise(resolve=>setTimeout(resolve,350))
  const settledText=[...host.querySelectorAll('.fm-text')].filter(node=>node.children.length).length
  await reader.setPage(999);await reader.setZoom(1.25)
  const last=reader.getState(),mounted=host.querySelectorAll('.fm-flow-page').length
  controller.abort();await new Promise(resolve=>requestAnimationFrame(resolve))
  const disposed=host.children.length===0
  host.remove();style.remove();window.Worker=WorkerOriginal
  return {openedMs,initial,last,mounted,disposed,workers,duringScrollText,settledText}
 })
 assert.equal(result.initial.state.pageCount,1000);assert(result.initial.mounted<=8);assert(result.initial.textLayers<=2)
 assert.equal(result.last.pageIndex,999);assert.equal(result.last.scale,1.25);assert(result.mounted<=8)
 assert.equal(result.duringScrollText,0);assert(result.settledText>0&&result.settledText<=2);
 assert(result.disposed);assert.equal(result.workers,0);assert.deepEqual(errors,[])
 console.log(JSON.stringify({realPDFPages:1000,bytes:bytes.byteLength,...result,note:'Local repeated-page PDF fixture; no competitor speed or arbitrary-PDF fidelity claim'}))
}finally{await browser.close();await example.close()}
