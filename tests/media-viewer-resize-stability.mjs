import assert from 'node:assert/strict'
import {chromium,firefox,webkit} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
import {installBrochureFixture} from './fixtures/brochure.mjs'
const engine=process.env.BROWSER??'chromium',example=await serveViewerExample(),browser=await ({chromium,firefox,webkit}[engine]).launch()
try{
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[]
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 await installBrochureFixture(page)
 await page.goto(example.url);await page.getByRole('button',{name:'Open Marly brochure',exact:true}).click();await page.waitForFunction(()=>window.exampleViewer?.())
 const root=page.locator('.fm')
 await root.getByRole('button',{name:'Thumbnails',exact:true}).click()
 await page.waitForFunction(()=>{const s=window.exampleViewer().element.shadowRoot;return s.querySelector('.fm-thumbnail[data-page="0"] canvas')?.dataset.loaded==='true'&&s.querySelector('.fm-page-source')?.width>1})
 async function dragLive(){
  const grip=await root.getByRole('separator',{name:'Resize thumbnails panel',exact:true}).boundingBox()
  await page.evaluate(()=>{
   const s=window.exampleViewer().element.shadowRoot,canvas=s.querySelector('.fm-thumbnail[data-page="0"] canvas')
   window.resizeProof={frames:[],canvas,previous:canvas.getContext('2d').getImageData(5,5,1,1).data.slice(),active:true}
   const sample=()=>{
    const p=window.resizeProof;if(!p.active)return
    const thumb=s.querySelector('.fm-thumbnail[data-page="0"] canvas'),source=s.querySelector('.fm-page-source'),stage=source.closest('.fm-stage'),viewport=s.querySelector('.fm-scroll')
    const rect=stage.getBoundingClientRect()
    p.frames.push({sameCanvas:thumb===p.canvas,loaded:thumb.dataset.loaded==='true',width:thumb.width,height:thumb.height,alpha:thumb.width>5?thumb.getContext('2d').getImageData(5,5,1,1).data[3]:0,sourceWidth:source.width,sourceHidden:source.hidden,stageWidth:rect.width,viewport:viewport.clientWidth,loading:stage.dataset.loading==='true',resizing:s.querySelector('.fm').dataset.resizing})
    requestAnimationFrame(sample)
   };requestAnimationFrame(sample)
  })
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down()
  let previousX=grip.x+grip.width/2
  for(const x of [350,420,520,680,560,410,260,340]){
   // WebKit coalesces programmatic mouse steps; deliver one movement per painted frame.
   for(let step=1;step<=6;step++){
    await page.mouse.move(previousX+(x-previousX)*step/6,grip.y+grip.height/2)
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
   }
   previousX=x
  }
  // Main document must change width while the pointer is still down.
  const during=await page.evaluate(()=>window.resizeProof.frames.filter(frame=>frame.resizing==='true'))
  assert(during.length>10,'Sample real painted drag frames')
  assert(new Set(during.map(frame=>Math.round(frame.stageWidth))).size>8,'Document must rescale before pointerup: '+JSON.stringify({widths:[...new Set(during.map(frame=>Math.round(frame.stageWidth)))],viewports:[...new Set(during.map(frame=>frame.viewport))],frames:during.length}))
  assert(during.every(frame=>frame.sameCanvas&&frame.loaded&&frame.width>1&&frame.height>1&&frame.alpha===255),'Loaded thumbnail must never be cleared during resize')
  assert(during.every(frame=>frame.sourceWidth>1&&!frame.sourceHidden&&!frame.loading),'Page preview must remain painted during resize')
  await page.mouse.up()
  // Include final high-quality refresh, not just live CSS scaling.
  await page.evaluate(()=>new Promise(resolve=>{let n=0;const next=()=>++n<30?requestAnimationFrame(next):resolve();requestAnimationFrame(next)}))
  const after=await page.evaluate(()=>{window.resizeProof.active=false;return window.resizeProof.frames})
  assert(after.every(frame=>frame.sameCanvas&&frame.loaded&&frame.width>1&&frame.alpha===255&&frame.sourceWidth>1&&!frame.sourceHidden&&!frame.loading),'Settling the resize must not blank either preview')
  return {frames:after.length,liveWidths:new Set(during.map(frame=>Math.round(frame.stageWidth))).size}
 }
 const paginated=await dragLive()
 await page.evaluate(()=>window.exampleViewer().setScrollMode('continuous'))
 await page.waitForFunction(()=>window.exampleViewer().element.shadowRoot.querySelector('.fm-flow-page')?.dataset.loading!=='true')
 const continuous=await dragLive()
 await page.evaluate(()=>window.exampleViewer().setPageLayout('double',true))
 await page.evaluate(()=>window.exampleViewer().setPage(1))
 await page.waitForFunction(()=>window.exampleViewer().getState().pageIndex===1)
 const double=await dragLive()
 // Mock slow background workers to prove resize never schedules a raster for each pixel width.
 const stableRaster=await page.evaluate(async()=>{
  const {createPDFThumbnails}=await import('/dist/pdf/thumbnails.js'),root=document.createElement('div'),canvas=document.createElement('canvas')
  root.style.cssText='position:fixed;left:0;top:0;width:300px;height:500px';canvas.style.cssText='width:188px;height:250px';root.append(canvas);document.body.append(root)
  let renders=0,releases=0
  const pdf={pageCount:1,getPageInfo:async()=>({width:600,height:800}),renderPage:async(index,target)=>{renders++;target.width=187;target.height=250;target.getContext('2d').fillRect(0,0,187,250)},releasePage:target=>{releases++;target.width=target.height=1}}
  const thumbs=createPDFThumbnails({document:pdf,root,maxSize:250})
  thumbs.sync([{index:0,canvas,width:188}])
  for(let n=0;n<20&&canvas.dataset.loaded!=='true';n++)await new Promise(resolve=>requestAnimationFrame(resolve))
  for(const width of [140,145,160,170,180,190,220,200,180])thumbs.sync([{index:0,canvas,width}])
  const result={renders,loaded:canvas.dataset.loaded,width:canvas.width}
  thumbs.destroy();root.remove();return result
 })
 assert.equal(stableRaster.renders,1);assert.equal(stableRaster.loaded,'true');assert(stableRaster.width>1)
 await page.evaluate(()=>window.exampleViewer().destroy())
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({engine,paginated,continuous,double,stableRaster,liveScale:true,noBlankFrames:true,errors:0}))
}finally{await browser.close();await example.close()}
