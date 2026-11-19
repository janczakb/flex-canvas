import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {PDFiumDocument} from '../dist/pdf/engine.js'
const require=createRequire(import.meta.url),wasm='data:application/wasm;base64,'+fs.readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')).toString('base64')
const sample=await PDFiumDocument.open(fs.readFileSync('examples/assets/sample.pdf'),wasm)
try{
 for(const index of [0,1,3]){
  const tile={x:64,y:128,width:384,height:384,pageWidth:1224,pageHeight:1584}
  const sync=sample.renderTile(index,tile),progressive=await sample.renderScheduled(index,tile,()=>false)
  const actual=new Uint8Array(progressive.rgba),expected=new Uint8Array(sync.rgba);let changed=0
  // PDFium's two renderer entry points can differ by one rounding step at glyph edges.
  for(let i=0;i<actual.length;i++){assert(Math.abs(actual[i]-expected[i])<=1,'No colour/channel/geometry deviation beyond one 8-bit rounding step');if(actual[i]!==expected[i])changed++}
  assert(changed/actual.length<.001,'Rounding differences stay below 0.1% of channels')
 }
}finally{sample.destroy()}
function densePDF(){
 const commands=Array.from({length:120000},(_,i)=>`${i%600} ${Math.floor(i/600)%760} 1 1 re f\n`).join('')
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}endstream`]
 let pdf='%PDF-1.7\n',offsets=[0]
 objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`})
 const xref=Buffer.byteLength(pdf);pdf+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return Buffer.from(pdf)
}
const dense=await PDFiumDocument.open(densePDF(),wasm)
try{
 let cancelled=false,heartbeats=0
 const heartbeat=setInterval(()=>{heartbeats++;cancelled=true},1),start=performance.now()
 try{await assert.rejects(dense.renderScheduled(0,{x:0,y:0,width:2048,height:2048,pageWidth:2048,pageHeight:2048},()=>cancelled,false),error=>error.code==='pdf_cancelled')}finally{clearInterval(heartbeat)}
 assert(heartbeats>0,'Worker event loop runs before the full dense render completes')
 assert(dense.renderTile(0,{x:0,y:0,width:32,height:32,pageWidth:612,pageHeight:792}).rgba.byteLength===4096,'Cancellation releases native render state for subsequent work')
 console.log(JSON.stringify({denseVectorPaths:120000,interrupted:true,eventLoopHeartbeats:heartbeats,cancelMs:performance.now()-start,visuallyEquivalentPages:3,nextRenderWorks:true}))
}finally{dense.destroy()}
