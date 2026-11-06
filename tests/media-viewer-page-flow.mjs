import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
const example=await serveViewerExample(),browser=await chromium.launch()
try{
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(example.url)
 const result=await page.evaluate(async()=>{
  const {createPDFPageFlow}=await import('/dist/pdf/page-flow.js')
  const {createViewerZoom}=await import('/dist/pdf/zoom.js');const zoom=createViewerZoom()
  const viewport=document.createElement('div');viewport.style.cssText='position:fixed;inset:0;width:600px;height:700px;overflow:auto;'
  const style=document.createElement('style');style.textContent='.fm-flow{position:relative}.fm-flow-page{position:absolute}.fm-flow-page>*{position:absolute;inset:0;width:100%;height:100%}'
  document.head.append(style);document.body.append(viewport)
  const controller=new AbortController(),infos=[],renders=[],text=[],tiles=[]
  const documentMock={pageCount:1000,
   getPageInfo:async index=>{infos.push(index);return {pageIndex:index,width:index===500?800:600,height:index===500?600:800,rotation:0}},
   renderPage:async(index,canvas,{signal})=>{signal.throwIfAborted();renders.push(index);canvas.width=canvas.height=8;return {}},
   renderTextLayer:async(index,layer)=>{text.push(index);layer.textContent='Page '+index},
   clearTextLayer:layer=>layer.replaceChildren(),releasePage:canvas=>{canvas.width=canvas.height=1},
   renderTile:async(index,tile,signal)=>{signal.throwIfAborted();tiles.push(index);return {width:tile.width,height:tile.height,rgba:new ArrayBuffer(tile.width*tile.height*4)}},
  }
  let current=0,complete
  const target=new Promise(resolve=>complete=resolve)
  const flow=await createPDFPageFlow({document:documentMock,viewport,signal:controller.signal,paint:()=>{},activate:scene=>{current=scene.index;if(current===999)complete()},current:()=>current,zoom,pinned:()=>false,error:error=>{throw error}})
  await flow.update()
  const initial={infos:new Set(infos).size,renders:new Set(renders).size,text:new Set(text).size,nodes:flow.scenes().length}
  await flow.goTo(500)
  await flow.update()
  await flow.goTo(999)
  await target
  const final={current,mounted:viewport.querySelectorAll('.fm-flow-page').length,rendered:new Set(renders).size}
  controller.abort()
  const disposed=viewport.children.length===0
  viewport.remove();style.remove()
  return {initial,final,disposed}
 })
 assert(result.initial.infos<8&&result.initial.renders<8&&result.initial.text<8,'Do not decode 1000 pages on opening')
 assert(result.final.mounted<=8,'Keep a bounded viewport window')
 assert(result.final.rendered<24,'Page jumps must skip intermediate pages')
 assert.equal(result.final.current,999)
 assert.equal(result.disposed,true)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({pages:1000,...result,note:'Resource-window test; not a cross-product speed benchmark'}))
}finally{await browser.close();await example.close()}
