import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {serveViewerExample} from '../scripts/serve.mjs'
const example=await serveViewerExample(),browser=await chromium.launch()
try {
    const page=await browser.newPage({viewport:{width:1440,height:940},acceptDownloads:true}),errors=[]
    page.setDefaultTimeout(10000)
    page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/brochures/*.pdf',route=>route.fulfill({path:'examples/assets/sample.pdf',contentType:'application/pdf'}))
    await page.goto(example.url)
    await page.getByRole('button',{name:'Open Marly brochure',exact:true}).click()
    await page.waitForFunction(()=>window.exampleViewer?.()?.getState().pageCount===4)
    const result=await page.evaluate(async()=>{
        const {openPDF}=await import('/dist/pdf.js')
        const doc=await openPDF({source:'/dist/samples/sample.pdf',workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm'})
        try {
            const text=await doc.getTextContent(1),metadata=await doc.getMetadata(),links=await doc.getLinks(0),outline=await doc.getOutline()
            const canvas=document.createElement('canvas')
            const first=doc.renderPage(0,canvas,{scale:3}).then(()=>false,error=>error.name==='AbortError')
            const latest=doc.renderPage(1,canvas,{scale:1})
            const stale=await first,raster=await latest
            const layer=document.createElement('div');await doc.renderTextLayer(1,layer)
            const selectable=layer.children.length>100
            const delayed=doc.getText(2).then(()=>false,error=>error.name==='AbortError')
            await doc.destroy()
            return {pages:metadata.pageCount,text:text.text.includes('page 2'),links:Array.isArray(links),outline:Array.isArray(outline),stale,latest:raster.pageIndex===1,selectable,closed:await delayed,cleaned:layer.children.length===0}
        } finally {await doc.destroy()}
    })
    assert.deepEqual(result,{pages:4,text:true,links:true,outline:true,stale:true,latest:true,selectable:true,closed:true,cleaned:true})
    const root=page.locator('.fm'),button=name=>root.getByRole('button',{name,exact:true})
    await button('Print').hover()
    await root.getByRole('tooltip',{name:'Print',exact:true}).waitFor()
    await button('Text').click()
    await root.locator('.fm-context').getByRole('button',{name:'Font color',exact:true}).waitFor()
    assert(await root.locator('.fm-context').getByRole('button',{name:'Fill color',exact:true}).isVisible())
    await button('Select and move').click()
    await button('Search document').click()
    await root.getByRole('searchbox',{name:'Find text'}).fill('FLEX')
    await root.getByRole('searchbox').press('Enter')
    await root.locator('.fm-search').getByText('1 of 8',{exact:true}).waitFor()
    await root.locator('.fm-search').getByRole('button',{name:'Close',exact:true}).click()
    await button('Download').click()
    const pendingDownload=page.waitForEvent('download')
    await root.getByRole('menuitem',{name:'Original PDF',exact:true}).click()
    assert((await pendingDownload).suggestedFilename().endsWith('.pdf'))
    await page.evaluate(async()=>{
        await window.exampleViewer().destroy()
        const {openMediaViewerModal}=await import('/dist/browser/index.js')
        window.readViewer=await openMediaViewerModal({mode:'read',name:'Read only',source:{kind:'pdf',source:'/dist/samples/sample.pdf',pdf:{workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm'}}})
    })
    assert.equal(await page.evaluate(()=>window.readViewer.getState().readOnly),true)
    assert.equal(await root.locator('.fm-edit-tools').count(),0)
    await page.evaluate(()=>window.readViewer.setTheme('dark'))
    assert.equal(await root.getAttribute('data-theme'),'dark')
    await page.evaluate(()=>window.readViewer.destroy())
    await page.getByRole('button',{name:'Open Leela brochure',exact:true}).click()
    await page.waitForFunction(()=>window.exampleViewer?.()?.getState().pageCount===4)
    const bounds=await root.boundingBox()
    assert.equal(bounds.width,1440);assert.equal(bounds.height,940)
    await button('Close').click()
    await root.waitFor({state:'detached'})
    assert(await page.getByRole('button',{name:'Open Leela brochure'}).evaluate(el=>el===document.activeElement),'Modal must restore opener focus')
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({...result,search:true,download:true,readMode:true,darkTheme:true,independent:true}))
} finally {await browser.close();await example.close()}
