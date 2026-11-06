import assert from 'node:assert/strict'
import {chromium,firefox,webkit} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {serveViewerExample} from '../scripts/serve.mjs'
import {installBrochureFixture} from './fixtures/brochure.mjs'
const engine=process.env.BROWSER??'chromium',example=await serveViewerExample(),browser=await ({chromium,firefox,webkit}[engine]).launch()
try{
 const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[]
 page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message))
 await installBrochureFixture(page)
 page.on('dialog',dialog=>{errors.push('Unexpected browser dialog: '+dialog.type());void dialog.dismiss()})
 await page.goto(example.url)
 for(const document of ['Open image sample','Open Marly brochure']){
  await page.getByRole('button',{name:document,exact:true}).click()
  await page.waitForFunction(()=>window.exampleViewer?.())
  const root=page.locator('.fm'),editor=root.locator('.fm-annotation-text-editor')
  const button=name=>root.getByRole('button',{name,exact:true})
  const shapes=()=>page.evaluate(()=>window.exampleViewer().getState().annotations)
  const choose=async tool=>{await button('Text tools').click();await root.getByRole('menuitemradio',{name:tool,exact:true}).click()}
  const clickPage=async(x,y)=>{const box=await root.locator('.fm-page-overlay').last().boundingBox();await page.mouse.click(box.x+box.width*x,box.y+box.height*y);return box}
  await choose('Text')
  await clickPage(.3,.35)
  await editor.waitFor();assert.equal(await root.getByRole('dialog').count(),0)
  await editor.pressSequentially('Review this section',{delay:15})
  assert.equal((await shapes()).length,1)
  assert.equal((await shapes())[0].text,'Review this section')
  const caret=await editor.evaluate(n=>({start:n.selectionStart,end:n.selectionEnd,value:n.value}))
  assert.equal(caret.end,caret.value.length)
  await button('Underline').click()
  await button('Align center').click()
  await root.locator('[data-property=fontFamily]').getByRole('button').click()
  await root.getByRole('option',{name:'Times New Roman',exact:true}).click()
  await editor.press('End');await editor.pressSequentially(' today')
  assert.equal((await shapes())[0].fontFamily,'Times New Roman')
  assert.equal((await shapes())[0].underline,true)
  assert.equal((await shapes())[0].align,'center')
  await editor.press('Control+Enter');await editor.waitFor({state:'hidden'})
  const text=(await shapes())[0];assert.equal(text.text,'Review this section today')
  await button('Undo').click();assert.equal((await shapes()).length,0,'Creating and formatting text is one undo transaction')
  await button('Redo').click();assert.equal((await shapes())[0].text,text.text)
  // Selecting an existing text annotation edits in place and Escape restores its original content.
  const bounds=await root.locator('.fm-page-overlay').last().boundingBox()
  await page.mouse.click(bounds.x+(text.points[0][0]+text.points[1][0])*bounds.width/2,bounds.y+(text.points[0][1]+text.points[1][1])*bounds.height/2)
  await editor.waitFor().catch(async error=>{throw new Error('Reopen text failed: '+JSON.stringify({document,bounds,text,after:await shapes(),tool:await root.getAttribute('data-tool')}),{cause:error})});await editor.fill('Discard me');await editor.press('Escape')
  assert.equal((await shapes())[0].text,text.text)
  await choose('Callout');const box=await clickPage(.6,.65)
  await editor.fill('Check the entrance')
  const callout=(await shapes()).find(s=>s.tool==='callout')
  assert(Math.abs(callout.points[3][0]-.6)<.01&&Math.abs(callout.points[3][1]-.65)<.01)
  assert(callout.points[0][0]>=0&&callout.points[1][0]<=1)
  assert(callout.points[0][1]>=0&&callout.points[1][1]<=1)
  await root.locator('[data-property=strokeColor]').getByRole('button').click()
  await root.locator('[data-slot=color-picker-popover]').getByRole('option',{name:'#2563eb',exact:true}).click()
  assert.equal((await shapes()).find(s=>s.tool==='callout').strokeColor,'#2563eb')
  await editor.press('Control+Enter')
  // Move the box and its leader with the existing selection handles, then reopen live editing.
  const old=(await shapes()).find(s=>s.tool==='callout')
  const x=box.x+(old.points[0][0]+old.points[1][0])*box.width/2,y=box.y+(old.points[0][1]+old.points[1][1])*box.height/2
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-18,y+12,{steps:6});await page.mouse.up()
  const moved=(await shapes()).find(s=>s.tool==='callout')
  assert(moved.points[0][0]<old.points[0][0]);assert(moved.points[0][1]>old.points[0][1])
  // Resizing the text box preserves the independent callout knee and arrow tip.
  const right=box.x+moved.points[1][0]*box.width,midY=box.y+(moved.points[0][1]+moved.points[1][1])*box.height/2
  await page.mouse.move(right+3,midY);await page.mouse.down();await page.mouse.move(right+38,midY,{steps:6});await page.mouse.up()
  const resized=(await shapes()).find(s=>s.tool==='callout')
  assert(resized.points[1][0]>moved.points[1][0]);assert.deepEqual(resized.points.slice(2),moved.points.slice(2))
  await page.evaluate(()=>window.exampleViewer().setTheme('dark'))
  assert.equal(await root.getAttribute('data-theme'),'dark')
  if(document.includes('brochure')){
   await mkdir('.internal/previews',{recursive:true})
   await page.screenshot({path:'.internal/previews/text-callout-'+engine+'.png'})
  }
  await page.evaluate(()=>window.exampleViewer().setTheme('light'))
  // Empty text is a cancelled local draft and does not enter stored annotation data.
  await choose('Text');await clickPage(.2,.8);await editor.waitFor();await editor.press('Control+Enter')
  assert.equal((await shapes()).length,2)
  // Delete confirmation must not commit or discard an in-progress draft on Cancel.
  await choose('Text');await clickPage(.15,.2);await editor.fill('Temporary draft')
  await button('Delete selected').click()
  await root.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(await editor.inputValue(),'Temporary draft')
  await button('Delete selected').click()
  await root.getByRole('dialog').getByRole('button',{name:'Delete selected',exact:true}).click()
  await editor.waitFor({state:'hidden'});assert.equal((await shapes()).length,2)
  if(document.includes('brochure')){
   const output=await page.evaluate(async()=>{const bytes=await window.exampleViewer().exportPDF();const {openPDF}=await import('/dist/pdf.js');const pdf=await openPDF({source:new Uint8Array(bytes),workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm'});try{return {bytes:bytes.byteLength,pages:pdf.pageCount}}finally{await pdf.destroy()}})
   assert(output.bytes>10000&&output.pages===25)
  }
  await page.evaluate(()=>window.exampleViewer().destroy())
 }
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({engine,imageAndPDF:true,nativeTyping:true,formatting:true,calloutTip:true,undoTransaction:true,cancel:true,export:true,errors:0}))
}finally{await browser.close();await example.close()}
