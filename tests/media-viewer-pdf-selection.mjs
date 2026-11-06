import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,firefox,webkit} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
const engine=process.env.BROWSER??'chromium',example=await serveViewerExample(),browser=await ({chromium,firefox,webkit}[engine]).launch()
try{
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[]
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/brochures/*.pdf',route=>route.fulfill({path:'examples/assets/sample.pdf',contentType:'application/pdf'}))
 await page.goto(example.url)
 await page.getByRole('button',{name:'Open Marly brochure',exact:true}).click()
 await page.waitForFunction(()=>window.exampleViewer?.()?.getState().pageCount===4)
 const root=page.locator('.fm'),menu=root.getByRole('toolbar',{name:'Selected text actions',exact:true})
 const select=async(index=0)=>{
  const layer=root.locator(`.fm-stage${index===null?'':`[data-page-index="${index}"]`} .fm-text`).first()
  const glyphs=layer.locator('span'),a=await glyphs.nth(0).boundingBox(),b=await glyphs.nth(10).boundingBox()
  assert(a&&b)
  await page.mouse.move(a.x+1,a.y+a.height/2);await page.mouse.down()
  await page.mouse.move(b.x+b.width-1,b.y+b.height/2,{steps:15});await page.mouse.up()
  await menu.waitFor({state:'visible'})
  const appearance=await layer.evaluate(layer=>{
   const native=getComputedStyle(layer.querySelector('[data-fff-text-box]'),'::selection')
   const boxes=[...layer.querySelectorAll('.fm-text-selection>span')].map(x=>x.getBoundingClientRect().toJSON())
   return {native:native.backgroundColor,boxes}
  })
  assert.equal(appearance.native,'rgba(0, 0, 0, 0)')
  assert.equal(appearance.boxes.length,1,'The selected heading has one continuous line, not per-glyph patches')

 }
 await root.getByRole('button',{name:'Print',exact:true}).hover()
 await root.getByRole('tooltip',{name:'Print',exact:true}).waitFor()
 assert.equal(await root.getByRole('textbox',{name:'Page',exact:true}).evaluate(el=>getComputedStyle(el).boxShadow),'none')
 const actions=['Highlight','Strikethrough','Underline','Squiggly underline','Add comment','Mark for redaction']
 for(const [index,action] of actions.entries()){
  await select(null)
  assert.equal(await menu.getByRole('button').count(),6)
  for(const name of actions){
   const control=menu.getByRole('button',{name,exact:true});assert(await control.isVisible())
   const center=await control.evaluate(el=>{const b=el.getBoundingClientRect(),i=el.querySelector('svg').getBoundingClientRect();return Math.abs((b.top+b.bottom-i.top-i.bottom)/2)})
   assert(center<.6,'Bubble icons must be vertically centered')
  }
  await menu.getByRole('button',{name:action,exact:true}).hover()
  assert.equal(await menu.getByRole('button',{name:action,exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)')
  await menu.getByRole('button',{name:action,exact:true}).click()
  if(action==='Add comment'){
   await root.getByRole('dialog').getByRole('textbox').fill('Review this wording')
   await root.getByRole('dialog',{name:'Comments',exact:true}).getByRole('button',{name:'Save comment',exact:true}).click()
   await root.getByRole('dialog',{name:'Comments',exact:true}).getByRole('button',{name:'Close',exact:true}).click()
  }
  assert.equal(await page.evaluate(()=>window.exampleViewer().getState().annotations.length),index===5?5:Math.min(index+1,4))
 }
 const shapes=await page.evaluate(()=>window.exampleViewer().getState().annotations)
 assert.deepEqual(shapes.map(s=>s.markup),['highlight','strikeout','underline','squiggle','redaction'])
 assert.equal(shapes[0].text,'Review this wording')
 // Selecting the same text twice never darkens or duplicates a highlight.
 await select(null);await menu.getByRole('button',{name:'Highlight',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.exampleViewer().getState().annotations.length),5)
 await page.evaluate(()=>window.exampleViewer().setScrollMode('continuous'))
 await root.locator('.fm-flow').waitFor()
 await page.waitForFunction(()=>window.exampleViewer().element.shadowRoot.querySelector('[data-page-index="0"] .fm-text span'))
 assert.equal(await root.getAttribute('data-scroll-mode'),'continuous')
 assert(await root.locator('.fm-flow-page').count()>1)
 await page.evaluate(()=>window.exampleViewer().setPage(1))
 await page.waitForFunction(()=>window.exampleViewer().getState().pageIndex===1)
 await page.waitForFunction(()=>{const p=window.exampleViewer().element.shadowRoot.querySelector('[data-page-index="1"]');return p&&!p.hasAttribute('data-loading')})
 await select(1)
 await menu.getByRole('button',{name:'Underline',exact:true}).click()
 assert.equal((await page.evaluate(()=>window.exampleViewer().getState().annotations)).at(-1).pageIndex,1)
 await page.evaluate(()=>window.exampleViewer().setPage(2))
 await page.waitForFunction(()=>window.exampleViewer().getState().pageIndex===2)
 await root.getByRole('button',{name:'Rectangle',exact:true}).click()
 const overlay=root.locator('[data-page-index="2"] .fm-page-overlay'),box=await overlay.boundingBox()
 await page.mouse.move(box.x+40,box.y+150);await page.mouse.down();await page.mouse.move(box.x+150,box.y+210,{steps:8});await page.mouse.up()
 assert.equal((await page.evaluate(()=>window.exampleViewer().getState().annotations)).at(-1).pageIndex,2)
 const count=await page.evaluate(()=>window.exampleViewer().getState().annotations.length)
 await page.evaluate(()=>window.exampleViewer().setScrollMode('paginated'))
 assert.equal(await root.locator('.fm-flow').count(),0)
 assert.equal(await page.evaluate(()=>window.exampleViewer().getState().pageIndex),2)
 assert.equal(await page.evaluate(()=>window.exampleViewer().getState().annotations.length),count)
 await root.getByRole('button',{name:'Page display',exact:true}).click()
 await root.getByRole('menuitemradio',{name:'Continuous scroll',exact:true}).click()
 await root.locator('.fm-flow').waitFor()
 await root.getByRole('button',{name:'Select and move',exact:true}).click()
 await page.evaluate(()=>window.exampleViewer().setPage(0))
 await page.waitForFunction(()=>window.exampleViewer().getState().pageIndex===0)
 await select(0)
 await mkdir('.internal/previews',{recursive:true})
 await page.screenshot({path:'.internal/previews/pdf-selection-and-flow.png'})
 // A genuine drag across two visible pages creates page-local markup.
 await page.evaluate(()=>window.exampleViewer().setZoom(.4))
 await page.evaluate(()=>window.exampleViewer().setPage(0))
 await page.waitForFunction(()=>window.exampleViewer().getState().pageIndex===0)
 const firstPage=root.locator('[data-page-index="0"] .fm-text [data-fff-text-box]'),secondPage=root.locator('[data-page-index="1"] .fm-text [data-fff-text-box]')
 await secondPage.first().waitFor()
 const first=await firstPage.nth(150).boundingBox(),last=await secondPage.nth(10).boundingBox()
 await page.mouse.move(first.x+first.width*.25,first.y+first.height/2);await page.mouse.down()
 await page.mouse.move(last.x+last.width-1,last.y+last.height/2,{steps:20});await page.mouse.up()
 await menu.waitFor({state:'visible'})
 await menu.getByRole('button',{name:'Strikethrough',exact:true}).click()
 const multi=await page.evaluate(()=>window.exampleViewer().getState().annotations.filter(shape=>shape.markup==='strikeout'))
 assert(multi.some(shape=>shape.pageIndex===0)&&multi.some(shape=>shape.pageIndex===1),'Cross-page selection must preserve each page index')
 await page.evaluate(()=>window.exampleViewer().destroy())
 assert.equal(await root.count(),0)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({engine,realPointerSelection:true,sixActions:true,idempotentHighlight:true,continuous:true,paginated:true,pageBoundAnnotations:true,printTooltip:true,flatPager:true,disposed:true}))
}finally{await browser.close();await example.close()}
