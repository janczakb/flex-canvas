import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {PDFiumDocument} from '../dist/pdf/engine.js'
import {chromium,firefox,webkit} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
import {installBrochureFixture} from './fixtures/brochure.mjs'
const engine=process.env.BROWSER??'chromium',example=await serveViewerExample(),browser=await ({chromium,firefox,webkit}[engine]).launch()
try{
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[]
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 await installBrochureFixture(page)
 await page.addInitScript(()=>{
  window.printProof=[]
  window.print=()=>{
   const images=[...document.querySelectorAll('.fm-print-page img')]
   window.printProof.push({pages:images.length,ready:images.every(image=>image.complete&&image.naturalWidth>100&&image.naturalHeight>100),loader:!!window.exampleViewer()?.element.shadowRoot.querySelector('.fm-print-progress'),styles:!!document.querySelector('link[href$="print.css"]')})
   if(!window.holdPrint)window.dispatchEvent(new Event('afterprint'))
  }
 })
 await page.goto(example.url);await page.getByRole('button',{name:'Open Marly brochure',exact:true}).click();await page.waitForFunction(()=>window.exampleViewer?.())
 const root=page.locator('.fm'),button=name=>root.getByRole('button',{name,exact:true})
 await button('Thumbnails').click()
 const list=root.locator('.fm-navigation-list'),panel=await list.boundingBox()
 // Many small wheel deltas must stay incremental through multiple virtual windows.
 await page.mouse.move(panel.x+panel.width/2,panel.y+panel.height/2)
 let previous=await list.evaluate(node=>node.scrollTop)
 for(let index=0;index<28;index++){
  await page.mouse.wheel(0,84)
  await page.waitForFunction(old=>{const node=window.exampleViewer().element.shadowRoot.querySelector('.fm-navigation-list');return node.scrollTop>old+20},previous)
  await list.evaluate(node=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
  const next=await list.evaluate(node=>node.scrollTop)
  assert(next>previous&&next-previous<200,`Thumbnail scroll jumped ${next-previous}px`);previous=next
 }
 const middle=previous
 for(let index=0;index<8;index++){
  await page.mouse.wheel(0,-84)
  await page.waitForFunction(old=>window.exampleViewer().element.shadowRoot.querySelector('.fm-navigation-list').scrollTop<old-20,previous)
  await list.evaluate(node=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
  const next=await list.evaluate(node=>node.scrollTop);assert(previous-next<200);previous=next
 }
 assert(previous>0&&previous<middle)
 assert((await list.getByRole('option').count())<25,'Thumbnail DOM remains windowed')
 await button('Thumbnails').click()
 // Native print is invoked only after every image is decoded and the progress modal has exited.
 let release
 await page.route('**/print.css',async route=>{await new Promise(resolve=>{release=resolve});await route.continue()})
 await button('Print').click()
 await root.getByRole('dialog',{name:'Preparing document for printing…',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.printProof.length),0)
 await mkdir('.internal/previews',{recursive:true});await page.screenshot({path:'.internal/previews/print-progress-'+engine+'.png'})
 assert.equal(await root.getByRole('dialog').getAttribute('data-slot'),'modal-dialog')
 await root.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
 await root.locator('.fm-print-progress').waitFor({state:'hidden'})
 release?.();await button('Print').waitFor();await page.waitForFunction(()=>!window.exampleViewer().element.shadowRoot.querySelector('[data-control=print]').disabled)
 assert.equal(await page.locator('.fm-print-document').count(),0)
 assert.equal(await page.evaluate(()=>window.printProof.length),0)
 await page.unroute('**/print.css');await page.evaluate(()=>{window.holdPrint=true});await button('Print').click()
 await page.waitForFunction(()=>window.printProof.length===1,null,{timeout:60000})
 const print=await page.evaluate(()=>window.printProof[0])
 assert.equal(print.pages,25);assert.equal(print.ready,true);assert.equal(print.loader,false);assert.equal(print.styles,true)
 if(engine==='chromium'){
  await mkdir('.internal/previews',{recursive:true})
  const filename='.internal/previews/prepared-print.pdf'
  await page.pdf({path:filename,displayHeaderFooter:true,preferCSSPageSize:true,printBackground:true})
  const bytes=await readFile(filename)
  assert(bytes.length>100000)
  const require=createRequire(import.meta.url),wasm=await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'))
  const pdf=await PDFiumDocument.open(bytes,'data:application/wasm;base64,'+wasm.toString('base64'))
  try{
   assert.equal(pdf.pageCount,25)
   for(let index=0;index<pdf.pageCount;index++)assert.equal(pdf.text(index,false).text.trim(),'','Printed pages must not contain browser dates, URLs or page counters')
  }finally{pdf.destroy()}
 }
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')))
 await page.waitForFunction(()=>document.querySelectorAll('.fm-print-document').length===0)
 // HeroUI insert modals: no native select, valid website/page links, invalid URL stays in the form.
 const choose=async item=>{await button('Insert').click();await root.getByRole('menuitemradio',{name:item,exact:true}).click()}
 const draw=async()=>{const box=await root.locator('.fm-page-overlay').last().boundingBox();await page.mouse.move(box.x+box.width*.15,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.35,{steps:5});await page.mouse.up()}
 await choose('Link');await draw()
 const dialog=root.getByRole('dialog',{name:'Link settings',exact:true})
 await dialog.waitFor();assert.equal(await dialog.locator('select').evaluateAll(nodes=>nodes.every(node=>node.closest('[aria-hidden=true]')||node.getBoundingClientRect().width<=1&&node.getBoundingClientRect().height<=1)),true);assert.equal(await dialog.getAttribute('data-slot'),'modal-dialog')
 await dialog.getByRole('textbox',{name:'Website',exact:true}).fill('javascript:alert(1)')
 await dialog.getByRole('button',{name:'Done',exact:true}).click();await dialog.getByRole('alert').waitFor()
 await dialog.getByRole('textbox',{name:'Website',exact:true}).fill('https://example.com/review')
 await dialog.getByRole('button',{name:'Done',exact:true}).click();await dialog.waitFor({state:'hidden'})
 assert.equal(await page.evaluate(()=>window.exampleViewer().getState().annotations[0].href),'https://example.com/review')
 await choose('Link');await draw();await dialog.waitFor()
 await dialog.locator('button[data-slot=select-trigger]').click();await root.getByRole('option',{name:'Page',exact:true}).click()
 await dialog.getByRole('textbox',{name:'Page number',exact:true}).fill('3');await dialog.getByRole('button',{name:'Done',exact:true}).click();await dialog.waitFor({state:'hidden'})
 assert.equal(await page.evaluate(()=>window.exampleViewer().getState().annotations[1].targetPage),2)
 await choose('Image');await draw()
 const imageDialog=root.getByRole('dialog',{name:'Add image',exact:true});await imageDialog.waitFor()
 await imageDialog.locator('input[type=file]').setInputFiles('examples/assets/sample.jpg')
 await imageDialog.getByRole('img',{name:'Image preview'}).waitFor()
 assert.equal(await imageDialog.getByRole('button',{name:'Done',exact:true}).isEnabled(),true)
 await mkdir('.internal/previews',{recursive:true});await page.screenshot({path:'.internal/previews/image-insert-'+engine+'.png'})
 await imageDialog.getByRole('button',{name:'Done',exact:true}).click();await imageDialog.waitFor({state:'hidden'})
 assert.equal(await page.evaluate(()=>window.exampleViewer().getState().annotations[2].tool),'image')
 await page.evaluate(()=>window.exampleViewer().destroy())
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({engine,incrementalThumbnailScroll:true,windowed:true,print,printCancel:true,printCleanup:true,heroUIModals:true,websiteAndPageLinks:true,imageInsert:true,errors:0}))
}finally{await browser.close();await example.close()}
