import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {chromium} from '@playwright/test'
import {PDFiumDocument} from '../dist/pdf/engine.js'
const require=createRequire(import.meta.url),wasm='data:application/wasm;base64,'+fs.readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')).toString('base64')
const sample=fs.readFileSync('examples/assets/sample.pdf'),xref=/startxref\s+(\d+)\s+%%EOF/.exec(sample.toString())?.[1]
assert(xref)
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flex-pdf-streaming-')),file=path.join(directory,'large.pdf'),size=512*1024*1024,fd=fs.openSync(file,'w+')
fs.writeSync(fd,sample);fs.ftruncateSync(fd,size);const tail=Buffer.from('\nstartxref\n'+xref+'\n%%EOF\n');fs.writeSync(fd,tail,0,tail.length,size-tail.length)
let reads=0
const pdf=await PDFiumDocument.openSource({size,read(offset,target){reads+=target.length;assert.equal(fs.readSync(fd,target,0,target.length,offset),target.length)},destroy(){}},wasm)
try{
 assert.equal(pdf.pageCount,4);assert.equal(pdf.canEditPages,false)
 assert(pdf.text(0,true).text.includes('FLEX'))
 const native=pdf.api.pdfium,heap=native.HEAPU8.byteLength
 await pdf.renderScheduled(0,{x:0,y:0,width:384,height:384,pageWidth:1224,pageHeight:1584},()=>false)
 assert(reads<8*1024*1024,'A 512MiB PDF must not be materialized to open or render')
 assert(heap<64*1024*1024,'WASM source memory must not scale to the 512MiB file')
 console.log(JSON.stringify({sparsePDFMiB:512,pageCount:pdf.pageCount,bytesRead:reads,wasmHeapBytes:heap,readOnlyLargeSource:true}))
}finally{pdf.destroy()}
const requests=[]
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost')
 if(['/range.pdf','/changed.pdf'].includes(url.pathname)){
  const m=/bytes=(\d+)-(\d+)/.exec(req.headers.range??'');if(!m){res.writeHead(400);res.end();return}
  const start=Number(m[1]),end=Math.min(size-1,Number(m[2]));requests.push({start,end})
  const bytes=Buffer.alloc(end-start+1);fs.readSync(fd,bytes,0,bytes.length,start)
  const etag=url.pathname==='/changed.pdf'&&start!==0?'"changed"':'"fixture-v1"'
  res.writeHead(206,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Content-Range':`bytes ${start}-${end}/${size}`,'ETag':etag,'Accept-Ranges':'bytes'});res.end(bytes);return
 }
 if(url.pathname.startsWith('/dist/')){
  const asset=path.resolve('.'+url.pathname)
  if(!asset.startsWith(path.resolve('dist')+path.sep)){res.writeHead(404);res.end();return}
  try{const bytes=fs.readFileSync(asset);res.writeHead(200,{'Content-Type':asset.endsWith('.wasm')?'application/wasm':asset.endsWith('.css')?'text/css':'text/javascript'});res.end(bytes)}catch{res.writeHead(404);res.end()};return
 }
 res.writeHead(200,{'Content-Type':'text/html'});res.end('<input type="file">')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch()
try{
 const page=await browser.newPage();page.setDefaultTimeout(20000)
 await page.goto('http://127.0.0.1:'+server.address().port)
 await page.locator('input').setInputFiles(file)
 const result=await page.evaluate(async()=>{
  const {openPDF}=await import('/dist/pdf.js'),file=document.querySelector('input').files[0],limits={maxBytes:1024*1024*1024,workerUrl:'/dist/pdfium-worker.js',wasmUrl:'/dist/pdfium.wasm'}
  const local=await openPDF({...limits,source:file});const localPages=local.pageCount;await local.renderPage(0,document.createElement('canvas'));await local.destroy()
  const remote=await openPDF({...limits,source:'/range.pdf',loading:'range'});const remotePages=remote.pageCount;const text=await remote.getText(3);await remote.destroy()
  let changed=false;try{const other=await openPDF({...limits,source:'/changed.pdf',loading:'range'});await other.getText(3);await other.destroy()}catch(e){changed=e.code==='pdf_range_changed'}
  return {localPages,remotePages,realText:text.includes('FLEX'),changed}
 })
 assert.equal(result.localPages,4);assert.equal(result.remotePages,4);assert(result.realText);assert(result.changed)
 assert(requests.reduce((sum,r)=>sum+r.end-r.start+1,0)<16*1024*1024)
 console.log(JSON.stringify({browserLocalBlob512MiB:true,verifiedHTTPRange512MiB:true,sourceChangeRejected:true,requests:requests.length,requestedBytes:requests.reduce((sum,r)=>sum+r.end-r.start+1,0)}))
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.closeSync(fd);fs.rmSync(directory,{recursive:true,force:true})}
