import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {chromium,firefox,webkit} from '@playwright/test'
const cdn=process.env.CANVAS_PUBLIC_CDN??'https://cdn.jsdelivr.net/npm/@useflex/canvas@0.1.0'
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html lang="en"><title>FLEX Canvas public CDN</title><button>Open</button><script src="${cdn}/dist/flex-canvas.js"></script></html>`)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let browser
try{
 for(const name of ['chromium','firefox','webkit']){
  browser=await ({chromium,firefox,webkit}[name]).launch()
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],failures=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failures.push({url:r.url(),error:r.failure()?.errorText}))
  await page.goto('http://127.0.0.1:'+server.address().port)
  await page.evaluate(async cdn=>{window.viewer=await FlexCanvas.open({name:'CDN PDF',source:{kind:'pdf',source:cdn+'/dist/samples/sample.pdf'},theme:'light'})},cdn)
  assert.equal(await page.evaluate(()=>window.viewer.getState().pageCount),4)
  await page.locator('.fm-skeleton').waitFor({state:'hidden'})
  await page.evaluate(()=>window.viewer.setPage(1))
  await page.locator('.fm').getByRole('button',{name:'Add signature',exact:true}).click()
  const dialog=page.locator('.fm').getByRole('dialog',{name:'Add Signature',exact:true})
  await dialog.waitFor();await dialog.getByRole('tab',{name:'Type',exact:true}).click()
  await dialog.locator('[data-fonts-ready=true]').waitFor()
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'})
  await page.evaluate(()=>window.viewer.destroy())
  await page.evaluate(async cdn=>{window.viewer=await FlexCanvas.open({source:{kind:'image',url:cdn+'/dist/samples/sample.jpg'},theme:'dark'})},cdn)
  assert.equal(await page.locator('.fm').getAttribute('data-theme'),'dark')
  await page.evaluate(()=>window.viewer.destroy())
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[])
  console.log(JSON.stringify({browser:name,cdn,pdf:true,image:true,signatureFonts:true,errors:0}))
  await browser.close();browser=undefined
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
