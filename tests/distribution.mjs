import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {chromium,firefox,webkit} from '@playwright/test'

const root=path.resolve(import.meta.dirname,'..'),temporary=await mkdtemp(path.join(tmpdir(),'flex-canvas-distribution-'))
const servers=[]
let activeBrowser
try {
    // Exercise the actual publish allowlist, not the development source tree.
    const packed=JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts','--pack-destination',temporary],{cwd:root,encoding:'utf8'}))[0]
    assert.equal(packed.name,'@useflex/canvas')
    assert(packed.files.some(({path})=>path==='dist/flex-canvas.js'))
    for(const {path:file} of packed.files)assert(!/(^|\/)(\.env[^/]*|AGENTS\.md|node_modules|tests|\.cache|\.internal)(\/|$)/.test(file),file)
    for(const file of ['LICENSE','COMMERCIAL.md','THIRD_PARTY_NOTICES.md','dist/browser/viewer.css','dist/pdfium-worker.js','dist/pdfium.wasm'])assert(packed.files.some(entry=>entry.path===file),file)
    const archive=path.join(temporary,packed.filename)
    execFileSync('tar',['-xzf',archive,'-C',temporary])
    const distribution=path.join(temporary,'package')
    const packageInfo=JSON.parse(await readFile(path.join(distribution,'package.json'),'utf8'))
    assert.equal(packageInfo.license,'SEE LICENSE IN LICENSE')
    assert((await readFile(path.join(distribution,'LICENSE'),'utf8')).includes('automatically includes commercial use of FLEX Canvas'))
    // Install as a real consumer and resolve the public entry and all declaration imports.
    const consumer=path.join(temporary,'consumer');await mkdir(consumer)
    await writeFile(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}))
    execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',archive],{cwd:consumer,stdio:'pipe'})
    await writeFile(path.join(consumer,'consumer.ts'),`import {openCanvas,mountCanvas,canvasAssets,type CanvasOptions} from '@useflex/canvas';
const options:CanvasOptions={source:{kind:'pdf',source:'/brochure.pdf'},theme:'light'};
// @ts-expect-error The theme belongs to the viewer, never the toolbar.
const invalid:CanvasOptions={source:{kind:'image',url:'/image.jpg'},toolbar:{theme:'light'}};
void openCanvas(options);void mountCanvas(document.body,options);void canvasAssets('/canvas/browser/');`)
    execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--skipLibCheck','--strict','--target','ES2022','--module','ES2022','--moduleResolution','Bundler',path.join(consumer,'consumer.ts')],{cwd:consumer,stdio:'pipe'})
    const requests=[]
    const mime={'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.pdf':'application/pdf','.jpg':'image/jpeg','.woff2':'font/woff2','.ttf':'font/ttf'}
    const cdn=createServer(async(req,res)=>{
        const route=decodeURIComponent(new URL(req.url,'http://cdn').pathname),file=path.resolve(distribution,'.'+route)
        requests.push(route)
        if(!file.startsWith(distribution+path.sep)){res.writeHead(404).end();return}
        try{res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'});res.end(await readFile(file))}catch{res.writeHead(404).end()}
    })
    await new Promise(resolve=>cdn.listen(0,'127.0.0.1',resolve));servers.push(cdn)
    const cdnUrl='http://127.0.0.1:'+cdn.address().port
    const app=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html lang="en"><title>FLEX Canvas installed distribution</title><button id="open">Open</button><div id="viewer" style="height:80vh"></div><script src="${cdnUrl}/dist/flex-canvas.js"></script></html>`)})
    await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));servers.push(app)
    const appUrl='http://127.0.0.1:'+app.address().port
    const results=[]
    for(const name of (process.env.CANVAS_BROWSERS??'chromium').split(',')){
        activeBrowser=await ({chromium,firefox,webkit}[name]).launch()
        const page=await activeBrowser.newPage({viewport:{width:1280,height:900}}),errors=[]
        page.on('pageerror',error=>errors.push(error.message))
        await page.addInitScript(()=>{
            window.workerLife={created:0,terminated:0,blobs:new Set()}
            const originalWorker=window.Worker,create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL)
            URL.createObjectURL=value=>{const url=create(value);if(value.type==='text/javascript')window.workerLife.blobs.add(url);return url}
            URL.revokeObjectURL=url=>{window.workerLife.blobs.delete(url);revoke(url)}
            window.Worker=class extends originalWorker{constructor(...args){super(...args);window.workerLife.created++}terminate(){window.workerLife.terminated++;super.terminate()}}
        })
        const before=requests.length
        await page.goto(appUrl)
        assert.deepEqual(requests.slice(before),['/dist/flex-canvas.js'],'Classic loader must defer the UI')
        await page.evaluate(async({cdnUrl})=>{
            window.viewer=await FlexCanvas.open({source:{kind:'pdf',source:cdnUrl+'/dist/samples/sample.pdf'},mode:'read',theme:'light'})
        },{cdnUrl})
        assert.equal(await page.evaluate(()=>window.viewer.getState().pageCount),4)
        await page.locator('.fm-skeleton').waitFor({state:'hidden'})
        assert(requests.includes('/dist/pdfium-worker.js'));assert(requests.includes('/dist/pdfium.wasm'))
        assert.equal(await page.evaluate(()=>window.workerLife.blobs.size),0,'Bootstrap must release after initialization')
        await page.evaluate(()=>window.viewer.destroy())
        assert.equal(await page.locator('.fm').count(),0)
        assert.deepEqual(await page.evaluate(()=>({created:workerLife.created,terminated:workerLife.terminated})),{created:1,terminated:1})
        const imageStart=requests.length
        await page.evaluate(async({cdnUrl})=>{
            const {mountCanvas}=await import(cdnUrl+'/dist/browser/index.js')
            window.viewer=await mountCanvas(document.querySelector('#viewer'),{source:{kind:'image',url:cdnUrl+'/dist/samples/sample.jpg'},theme:'dark'})
        },{cdnUrl})
        assert.equal(await page.locator('.fm').getAttribute('data-theme'),'dark')
        assert(!requests.slice(imageStart).some(url=>url.endsWith('.wasm')||url.endsWith('/pdfium-worker.js')),'Images must not load the PDF engine')
        const workspace=page.locator('.fm')
        await workspace.getByRole('button',{name:'Add signature',exact:true}).click()
        const signature=workspace.getByRole('dialog',{name:'Add Signature',exact:true})
        await signature.waitFor()
        const darkBackground=await signature.evaluate(node=>getComputedStyle(node).backgroundColor)
        await page.evaluate(()=>window.viewer.setTheme('light'))
        const lightBackground=await signature.evaluate(node=>getComputedStyle(node).backgroundColor)
        assert.notEqual(darkBackground,lightBackground,'Open dialogs must follow the global theme live')
        await signature.getByRole('button',{name:'Close',exact:true}).click()
        await signature.waitFor({state:'hidden'})
        await page.emulateMedia({colorScheme:'dark'})
        await page.evaluate(()=>window.viewer.setTheme('auto'))
        await page.waitForFunction(()=>window.viewer.element.shadowRoot.querySelector('.fm').dataset.theme==='dark')
        await page.emulateMedia({colorScheme:'light'})
        await page.waitForFunction(()=>window.viewer.element.shadowRoot.querySelector('.fm').dataset.theme==='light')
        assert.equal(await page.evaluate(()=>window.viewer.theme),'auto')
        await page.evaluate(()=>window.viewer.setTheme('dark'))
        await page.emulateMedia({colorScheme:'light'})
        assert.equal(await workspace.getAttribute('data-theme'),'dark','Explicit theme must ignore system changes')
        const rejected=await page.evaluate(async({cdnUrl})=>{
            const {mountCanvas}=await import(cdnUrl+'/dist/browser/index.js')
            try{await mountCanvas(document.body,{source:{kind:'image',url:cdnUrl+'/dist/samples/sample.jpg'},toolbar:{theme:'light'}});return false}
            catch(error){return error instanceof TypeError}
        },{cdnUrl})
        assert(rejected,'Removed toolbar.theme must not be silently accepted')
        await page.evaluate(()=>window.viewer.destroy())
        assert.deepEqual(errors,[])
        results.push({browser:name,pdf:true,image:true,classic:true,esm:true,css:true,globalTheme:true,systemThemeChanges:true,workerCleanup:true})
        await activeBrowser.close();activeBrowser=undefined
    }
    console.log(JSON.stringify({package:packed.name,version:packed.version,files:packed.entryCount,bytes:packed.size,consumerInstall:true,types:true,crossOrigin:results}))
} finally {
    await activeBrowser?.close()
    for(const server of servers)await new Promise(resolve=>server.close(resolve))
    await rm(temporary,{recursive:true,force:true})
}
