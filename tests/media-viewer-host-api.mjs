import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
const example=await serveViewerExample(),browser=await chromium.launch()
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.setDefaultTimeout(15000)
 page.on('pageerror',error=>errors.push(error.message));await page.goto(example.url)
 const result=await page.evaluate(async()=>{
  const {mountPDFReader}=await import('/dist/browser/reader.js'),{openPDF}=await import('/dist/pdf.js'),{createPDFTileCache}=await import('/dist/pdf/tile-surface.js')
  const link=document.createElement('link');link.rel='stylesheet';link.href='/dist/reader.css';document.head.append(link)
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:white';document.body.append(host)
  const progress=[],searchProgress=[],printProgress=[]
  const reader=await mountPDFReader(host,{source:'/dist/samples/sample.pdf',workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm',onProgress:value=>progress.push(value),onSearchChange:value=>searchProgress.push(value)})
  const hits=await reader.search('FLEX',{limit:5});await reader.nextSearchResult();const search=reader.getSearchState()
  const previous=reader.search('project'),newer=reader.search('FLEX',{limit:2});let oldAborted=false
  try{await previous}catch(error){oldAborted=error.name==='AbortError'}await newer
  const printOriginal=window.print;let printedPages=0
  window.print=()=>{printedPages=document.querySelectorAll('.fm-print-page').length;queueMicrotask(()=>window.dispatchEvent(new Event('afterprint')))}
  const printed=await reader.print({title:'Host print',assetBaseUrl:'/dist/browser/',onProgress:(done,total)=>printProgress.push({done,total})})
  window.print=printOriginal
  reader.destroy();host.remove();link.remove()
  const pdf=await openPDF({source:'/dist/samples/sample.pdf',workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm',rasterTransport:'bitmap'})
  const tile={x:64,y:128,width:384,height:384,pageWidth:1224,pageHeight:1584}
  const bitmap=await pdf.renderTileBitmap(0,tile),rgba=await pdf.renderTile(0,tile),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
  const ctx=canvas.getContext('2d');ctx.drawImage(bitmap.bitmap,0,0);const actual=ctx.getImageData(0,0,384,384).data,expected=new Uint8Array(rgba.rgba)
  let maximumDelta=0;for(let i=0;i<actual.length;i++)maximumDelta=Math.max(maximumDelta,Math.abs(actual[i]-expected[i]))
  const cache=createPDFTileCache();cache.set('sample',bitmap);cache.clear();const bitmapReleased=bitmap.bitmap.width===0
  let closed=0;for(let i=0;i<8;i++)cache.set(String(i),{width:1024,height:1024,bitmap:{close(){closed++}}});const evicted=closed;cache.clear()
  await pdf.destroy()
  const fullHost=document.createElement('div');fullHost.style.cssText='position:fixed;inset:0';document.body.append(fullHost)
  const {mountMediaViewer}=await import('/dist/browser/index.js')
  const full=await mountMediaViewer(fullHost,{source:{kind:'pdf',source:'/dist/samples/sample.pdf',pdf:{workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm'}},mode:'read',showToolbar:false,assetBaseUrl:'/dist/browser/'})
  const toolbarAbsent=!full.element.shadowRoot.querySelector('.fm-top'),fullHits=await full.search('FLEX');full.nextSearchResult();await full.destroy();fullHost.remove()
  return {hits:hits.length,search,oldAborted,printed,printedPages,printProgress,phases:[...new Set(progress.map(p=>p.phase))],downloadCounters:progress.some(p=>p.phase==='download'&&p.loaded>0),searchReports:searchProgress.length,bitmapReleased,maximumDelta,evicted,totalClosed:closed,toolbarAbsent,fullHits:fullHits.length}
 })
 assert.equal(result.hits,5);assert.equal(result.search.index,2);assert(result.oldAborted);assert(result.printed);assert.equal(result.printedPages,4)
 assert.equal(result.printProgress.at(-1).done,4);assert(result.phases.includes('ready'));assert(result.phases.includes('render'));assert(result.downloadCounters)
 assert(result.bitmapReleased);assert(result.maximumDelta<=1);assert.equal(result.evicted,2);assert.equal(result.totalClosed,8)
 assert(result.toolbarAbsent);assert(result.fullHits>0);assert.deepEqual(errors,[])
 console.log(JSON.stringify({...result,realHostControls:true,printUsesAllPages:true,noForcedMenuClicks:true}))
}finally{await browser.close();await example.close()}
