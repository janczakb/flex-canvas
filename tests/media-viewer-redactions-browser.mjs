import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {chromium,firefox,webkit} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
import {PDFiumDocument} from '../dist/pdf/engine.js'
const engine=process.env.BROWSER??'chromium',example=await serveViewerExample(),browser=await({chromium,firefox,webkit}[engine]).launch()
try{
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[]
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/brochures/*.pdf',r=>r.fulfill({path:'examples/assets/sample.pdf',contentType:'application/pdf'}))
 await page.goto(example.url);await page.getByRole('button',{name:'Open Marly brochure',exact:true}).click()
 await page.waitForFunction(()=>window.exampleViewer?.()?.getState().pageCount===4)
 const root=page.locator('.fm'),menu=root.getByRole('toolbar',{name:'Selected text actions',exact:true})
 const glyphs=root.locator('.fm-text [data-fff-text-box]'),a=await glyphs.nth(0).boundingBox(),b=await glyphs.nth(10).boundingBox()
 await page.mouse.move(a.x+1,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width-1,b.y+b.height/2,{steps:16});await page.mouse.up()
 await menu.getByRole('button',{name:'Mark for redaction',exact:true}).click()
 const redactions=root.locator('.fm-redaction-controls')
 await redactions.waitFor({state:'visible'})
 let shapes=await page.evaluate(()=>window.exampleViewer().getState().annotations)
 assert.equal(shapes.length,1);assert.equal(shapes[0].markup,'redaction');assert.equal(shapes[0].fill,'#000000')
 await redactions.getByRole('textbox',{name:'Insert overlay text',exact:true}).fill('PRIVATE')
 await redactions.getByText('Repeat text',{exact:true}).click();await page.waitForFunction(()=>window.exampleViewer().getState().annotations[0]?.repeatOverlayText===true)
 await redactions.getByRole('button',{name:'Add comment',exact:true}).click()
 await root.getByRole('dialog').getByRole('textbox').fill('Remove this heading')
 await root.getByRole('dialog',{name:'Comments',exact:true}).getByRole('button',{name:'Save comment',exact:true}).click()
   await root.getByRole('dialog',{name:'Comments',exact:true}).getByRole('button',{name:'Close',exact:true}).click()
 shapes=await page.evaluate(()=>window.exampleViewer().getState().annotations)
 assert.equal(shapes[0].overlayText,'PRIVATE');assert.equal(shapes[0].repeatOverlayText,true);assert.equal(shapes[0].text,'Remove this heading')
 await root.getByRole('button',{name:'Pan',exact:true}).click();await redactions.waitFor({state:'hidden'})
 await root.getByRole('button',{name:'Select and move',exact:true}).click()
 await page.mouse.click(a.x+a.width/2,a.y+a.height/2)
 await redactions.waitFor({state:'visible'})
 await mkdir('.internal/previews',{recursive:true});await page.screenshot({path:'.internal/previews/pdf-redaction-marked.png'})
 // Cancelling either deletion or application must preserve the original and the complete mark.
 await redactions.getByRole('button',{name:'Delete selected',exact:true}).click()
 await root.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.exampleViewer().getState().annotations.length),1)
 await redactions.getByRole('button',{name:'Apply redactions',exact:true}).click()
 await root.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.exampleViewer().getState().annotations.length),1)
 await redactions.getByRole('button',{name:'Apply redactions',exact:true}).click()
 await root.getByRole('dialog').getByRole('button',{name:'Apply redactions',exact:true}).click()
 await page.waitForFunction(()=>window.exampleViewer().getState().annotations.length===0)
 await page.waitForFunction(()=>window.exampleViewer().element.shadowRoot.querySelector('[role=status]').textContent.includes('Redactions applied'))
 assert(!await root.locator('.fm-text').innerText().then(t=>t.includes('FLEX project')),'Applied text must disappear from the live text layer')
 const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await window.exampleViewer().exportPDF())))
 const require=createRequire(import.meta.url),wasm='data:application/wasm;base64,'+Buffer.from(await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'))).toString('base64')
 const output=await PDFiumDocument.open(new Uint8Array(bytes),wasm)
 try{assert(!output.text(0,false).text.includes('FLEX project'));assert(output.text(0,false).text.includes('PRIVATE'));assert(output.text(1,false).text.includes('FLEX project'));assert.equal(output.search(0,'FLEX project',false,false,50).length,0)}finally{output.destroy()}
 await page.screenshot({path:'.internal/previews/pdf-redaction-applied.png'})
 // Applying is irreversible in this editing session; undo cannot restore removed content.
 await root.getByRole('button',{name:'Undo',exact:true}).isDisabled().then(assert)
 // A real application adapter rejecting replacement cannot partially swap the document.
 await page.evaluate(async()=>{
  const old=window.exampleViewer();await old.destroy()
  const {mountMediaViewer}=await import('/dist/browser/index.js'),host=document.createElement('div');host.style.height='100vh';document.body.append(host)
  const shape={id:'guarded',tool:'text-highlight',markup:'redaction',color:'#dc2626',stroke:1,points:[[0,0],[1,1]],rectangles:[[.08,.07,.56,.04]],fill:'#000000'}
  window.guardedViewer=await mountMediaViewer(host,{source:{kind:'pdf',source:'/dist/samples/sample.pdf',pdf:{workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm'}},annotations:[shape],replacePdf:async()=>{throw new Error('Storage rejected this revision')}})
 })
 const rejection=await page.evaluate(async()=>{
  const v=window.guardedViewer;let failed=false;try{await v.applyRedactions({confirm:false})}catch{failed=true}
  const {openPDF}=await import('/dist/pdf.js'),d=await openPDF({source:new Uint8Array(await v.exportPDF()),workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm'})
  try{return{failed,marks:v.getState().annotations.length,original:(await d.getText(0)).includes('FLEX project review'),busy:v.element.shadowRoot.querySelector('.fm').getAttribute('aria-busy')}}finally{await d.destroy();await v.destroy()}
 })
 assert.deepEqual(rejection,{failed:true,marks:1,original:true,busy:'false'})
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({engine,realPointer:true,selectable:true,overlayText:true,repeat:true,comment:true,cancelPreserves:true,nativeTextRemoved:true,searchRemoved:true,otherPagesPreserved:true,undoCannotRestore:true}))
}finally{await browser.close();await example.close()}
