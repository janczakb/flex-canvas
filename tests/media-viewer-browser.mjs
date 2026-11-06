import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {PDFiumDocument} from '../dist/pdf/engine.js'
const require=createRequire(process.cwd()+'/package.json')
const {chromium}=require('@playwright/test')
const browser=await chromium.launch()
const ctx=await browser.newContext({viewport:{width:1440,height:940}})
const page=await ctx.newPage()
page.setDefaultTimeout(8000)
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
const wasm = await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'))
const document = await PDFiumDocument.open(await readFile('examples/assets/sample.pdf'), 'data:application/wasm;base64,' + wasm.toString('base64'))
let largePDF
try {
    largePDF = document.editPages(Array.from({length:500},(_,index)=>({index:index%4,rotation:0})),500,25*1024*1024)
} finally { document.destroy() }
await page.addInitScript(() => {
    const OriginalWorker = window.Worker
    window.workerProof = {created:0,terminated:0,active:0,maxActive:0,renders:0,tiles:0}
    window.Worker = class extends OriginalWorker {
        constructor(...args) { super(...args);window.workerProof.created++;this.addEventListener('message',()=>{window.workerProof.active--}) }
        postMessage(message,...args) {
            window.workerProof.active++;window.workerProof.maxActive=Math.max(window.workerProof.maxActive,window.workerProof.active)
            if(message.method==='render')window.workerProof.renders++
            if(message.method==='renderTile')window.workerProof.tiles++
            return super.postMessage(message,...args)
        }
        terminate(){window.workerProof.terminated++;super.terminate()}
    }
})
const server=createServer(async(req,res)=>{
    const route=new URL(req.url,'http://local').pathname
    if(route==='/'){
        res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><title>FLEX SDK CSS verification</title><div id="viewer" style="height:80vh"></div><script type="module">
        import {mountMediaViewer} from '/browser/index.js'
        const source = new URL(location.href).searchParams.has('pdf')
            ? {kind:'pdf',source:'/large.pdf',pdf:{workerUrl:'/pdfium-worker.js',wasmUrl:'/pdfium.wasm'}}
            : {kind:'image',url:'/sample.jpg'}
        window.api = await mountMediaViewer(document.getElementById('viewer'), {
            source,styleSheets:['/custom.css'],locale:'en',
            saveAnnotations:async()=>{},
        })
        </script></html>`);return
    }
    if(route==='/large.pdf'){res.setHeader('Content-Type','application/pdf');res.end(Buffer.from(largePDF));return}
    if(route==='/custom.css'){res.setHeader('Content-Type','text/css');res.end('.fm { --verify-custom: applied; }');return}
    const file=route==='/sample.jpg'?'examples/assets/sample.jpg':path.join('dist',route)
    try{
        const type=route.endsWith('.css')?'text/css':route.endsWith('.js')?'text/javascript':route.endsWith('.wasm')?'application/wasm':'image/jpeg'
        if(route.endsWith('/heroui.css'))await new Promise(r=>setTimeout(r,800))
        res.setHeader('Content-Type',type);res.end(await readFile(file))
    }catch{res.statusCode=404;res.end()}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
try{
    const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname))
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'commit'})
    const root=page.locator('.fm')
    await root.locator('.fm-top-skeleton').waitFor()
    await root.locator('.fm-skeleton').waitFor()
    await page.waitForFunction(()=>window.api)
    assert.deepEqual(requests.filter(p=>p.endsWith('.css')),['/browser/properties.css','/browser/heroui.css','/browser/viewer.css','/custom.css'])
    assert(!requests.some(p=>/wasm|pdfium/.test(p)))
    const rendering=await page.evaluate(()=>{
        const root=window.api.element.shadowRoot
        return {inlineStyles:root.querySelectorAll('style').length, links:[...root.querySelectorAll('link')].map(el=>el.sheet!==null), custom:getComputedStyle(root.querySelector('.fm')).getPropertyValue('--verify-custom').trim()}
    })
    assert.deepEqual(rendering,{inlineStyles:0,links:[true,true,true],custom:'applied'})
    const propertyCSS=await readFile('dist/browser/properties.css','utf8')
    assert(propertyCSS.includes('@property --tw-border-style'))
    assert.equal(propertyCSS.replace(/@property\s+--[\w-]+\s*\{[^{}]*\}/g,'' ).trim(),'')
    await page.evaluate(async()=>{
        const {mountMediaViewer}=await import('/browser/index.js')
        const host=document.createElement('div');document.body.append(host)
        const second=await mountMediaViewer(host,{source:{kind:'image',url:'/sample.jpg'},saveAnnotations:async()=>{}})
        if(document.querySelectorAll('link[data-fm-properties]').length!==1)throw new Error('Property registration lease was duplicated')
        second.destroy();host.remove()
    })
    assert.equal(await page.locator('link[data-fm-properties]').count(),1)
    const btn=(name)=>root.getByRole('button',{name,exact:true})
    await btn('Shapes').click()
    const item=root.getByRole('menuitemradio',{name:'Rectangle'})
    await item.click()
    assert.equal(await page.locator('body').getAttribute('inert'),null)
    const stage=root.locator('.fm-stage'), rect=await stage.boundingBox(), overlay=stage.locator('canvas').last(), b=await overlay.boundingBox()
    await btn('Stroke color').click()
    const swatch=root.locator('[data-slot="color-swatch-picker-item"]').nth(2)
    await swatch.click()
    await page.keyboard.press('Escape')
    await page.mouse.move(b.x+b.width*.2,b.y+b.height*.2);await page.mouse.down()
    await page.mouse.move(b.x+b.width*.6,b.y+b.height*.6,{steps:9});await page.mouse.up()
    assert.equal(await page.evaluate(()=>window.api.getState().annotations.length),1)
    await btn('Select and move').click()
    assert.deepEqual(await stage.boundingBox(),rect)
    await page.setViewportSize({width:390,height:840})
    await page.waitForFunction(()=>window.api.element.shadowRoot.querySelector('.fm').dataset.layout==='narrow')
    await btn('Drawing').click()
    const context=root.locator('.fm-context'), contextBar=context.getByRole('toolbar')
    await contextBar.getByRole('button',{name:'Stroke width',exact:true}).click()
    assert(await contextBar.getByRole('button',{name:'Back to document tools',exact:true}).isVisible())
    assert.equal(await context.locator('.fm-property:not([hidden])').count(),1)
    await contextBar.getByRole('button',{name:'Back to document tools',exact:true}).click()
    assert.equal(await context.locator('.fm-property:not([hidden])').count(),5)
    await page.keyboard.press('Escape')

    await context.waitFor({state:'hidden'})
    await btn('Notes and pins').click()
    await root.getByRole('menuitemradio',{name:'Numbered pin'}).click()
    await page.keyboard.press('Escape')
    assert(await root.evaluate(e=>e.scrollWidth<=e.clientWidth+1))
    await page.evaluate(()=>window.api.destroy())
    assert.equal(await page.locator('#viewer>div').count(),0)
    assert.equal(await page.locator('link[data-fm-properties]').count(),0)
    assert.deepEqual(errors,[])
    console.log('Image: separate CSS, no inline stylesheet, override order, skeleton, HeroUI menu/color picker, desktop/mobile, disposal.')
    await page.setViewportSize({width:1440,height:940})
    await page.goto('http://127.0.0.1:'+server.address().port+'/?pdf')
    await page.waitForFunction(()=>window.api?.getState().pageCount===500)
    await root.locator('.fm-pdf-tiles canvas[data-loaded="true"]').first().waitFor()
    const beforeZoom=await page.evaluate(()=>window.workerProof.tiles)
    await page.evaluate(()=>window.api.setPage(490))
    await root.locator('.fm-pdf-tiles canvas[data-loaded="true"]').first().waitFor()
    await btn('Thumbnails').click()
    const list=root.locator('.fm-navigation-list')
    await list.locator('canvas[data-loaded="true"]').first().waitFor()
    assert(await list.getByRole('option',{name:'Page 491',exact:true}).isVisible(),'Thumbnail window must follow current page')
    assert(await list.locator('canvas').count()<=24,'Thumbnail DOM must remain bounded')
    await list.evaluate(e=>{e.scrollTop=0})
    await list.getByRole('option',{name:'Page 1',exact:true}).waitFor()
    await list.evaluate(e=>{e.scrollTop=e.scrollHeight})
    await list.getByRole('option',{name:'Page 500',exact:true}).waitFor()
    assert(await list.locator('canvas').count()<=24)
    await root.getByRole('button',{name:'Thumbnails',exact:true}).click()
    for(let n=0;n<4;n++)await btn('Zoom in').click()
    await page.waitForFunction(n=>window.workerProof.tiles>n,beforeZoom)
    assert(await root.locator('.fm-pdf-tiles canvas').count()<=64,'Detail canvas count must remain bounded')
    const proof=await page.evaluate(()=>({...window.workerProof,page:window.api.getState().pageIndex}))
    assert.equal(proof.created,1);assert.equal(proof.maxActive,1);assert.equal(proof.page,490)
    await page.evaluate(()=>window.api.destroy())
    assert.equal(await page.evaluate(()=>window.workerProof.terminated),1)
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({pages:500,thumbnailWindowMax:24,detailCanvasMax:64,...proof,destroyTerminatesWorker:true}))
}catch(error){await page.screenshot({path:'/tmp/flex-sdk-css-error.png'}).catch(()=>{});console.error(error.stack,errors);process.exitCode=1}
finally{await browser.close();await new Promise(r=>server.close(r))}
