import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {groupPDFParagraphs} from '../dist/pdf/text-paragraphs.js'
import {PDFiumDocument} from '../dist/pdf/engine.js'
import {pdfSelectionLines} from '../dist/pdf/text-lines.js'
import {openPDF} from '../dist/pdf.js'
const require=createRequire(import.meta.url)
const wasm=fs.readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'))
const wasmUrl='data:application/wasm;base64,'+wasm.toString('base64')
// A two-column layout groups aligned body lines and preserves the heading and column gap.
const textRun=(index,text,x,y,width,size=12)=>({index,text,x,y,width,height:size/1000,font:'Helvetica',appearance:{size,color:'#000000'}})
const paragraphs=groupPDFParagraphs([
 textRun(0,'Intro',.1,.06,.18,36),
 textRun(1,'Left column first line',.1,.2,.35),
 textRun(2,'Right column first line',.54,.2,.34),
 textRun(3,'left continuation.',.1,.215,.20),
 textRun(4,'right continuation.',.54,.215,.20),
 textRun(5,'Separate left paragraph.',.1,.243,.31),
],792)
assert.deepEqual(paragraphs.map(block=>block.text),[
 'Intro','Left column first line\nleft continuation.','Right column first line\nright continuation.','Separate left paragraph.',
])
const fragmented=groupPDFParagraphs([
 {...textRun(0,'con',.1,.2,.035),rotation:0,baseline:.22},
 {...textRun(1,'fi',.136,.204,.006),height:.013,rotation:0,baseline:.22},
 {...textRun(2,'dentielle.',.143,.2,.09),rotation:0,baseline:.22},
 {...textRun(3,'Vertical',.6,.2,.01),height:.15,rotation:Math.PI/2,baseline:.22},
],792)
assert.deepEqual(fragmented.map(block=>block.text),['confidentielle.','Vertical'],'A narrow ligature shares its baseline with the word while rotated text stays independent')
const bytes=fs.readFileSync(new URL('../examples/assets/sample.pdf',import.meta.url))
let checks=0
const check=(condition,message)=>{assert(condition,message);checks++}
const start=performance.now()
const document=await PDFiumDocument.open(bytes,wasmUrl)
try {
 check(document.pageCount===4,'Four real pages')
 check(document.pageSizes().every((size,index)=>size.width===document.info(index).width&&size.height===document.info(index).height),'Bulk geometry matches actual page sizes without page rasterization')
 check(document.info(0).width===612&&document.info(3).height===792,'Page geometry')
 const text=document.text(0,true)
 check(text.text.includes('FLEX project review'),'Native text extraction')
 check(text.glyphs.length>100,'Native selectable text geometry')
 const lines=pdfSelectionLines(text)
 check(lines[0].glyphs.map(item=>item.glyph.text).join('')==='FLEX project review - page 1','PDF line grouping preserves real reading order')
 check(lines[0].height>.03&&lines[0].glyphs.every(item=>item.width>0),'Uniform font line boxes include spaces and descenders')
 check(text.glyphs.every(g=>g.selection&&g.selection.height>0),'Native loose character boxes are available for continuous selection')
 check(text.glyphs.every(g=>[g.x,g.y,g.width,g.height].every(Number.isFinite)),'Finite glyph coordinates')
 const hits=document.search(0,'FLEX',true,true,100)
 check(hits.length===2&&hits[0].start===0,'Native whole word search')
 check(document.search(0,'flex',true,false,100).length===0,'Case sensitive search')
 check(document.search(0,'flex',false,false,1).length===1,'Search result bound')
 check(hits.every(hit=>hit.rectangles.length&&hit.rectangles.every(r=>r.width>0&&r.height>0)),'Search highlight geometry')
 check(document.metadata().pageCount===4&&document.metadata().permissions===4294967295,'Native metadata and unsigned permissions')
 check(Array.isArray(document.outline())&&Array.isArray(document.links(0)),'Optional outline and link absence')
 const renderStart=performance.now(),raster=document.render(0,612,792),renderMs=performance.now()-renderStart
 check(raster.rgba.byteLength===612*792*4,'Native RGBA page raster')
 const pixels=new Uint8Array(raster.rgba)
 check(pixels.some((v,i)=>i%4!==3&&v<150),'Rendered page contains visible marks')
 assert.throws(()=>document.render(0,8192,8192),e=>e.code==='pdf_render_limit');checks++
 assert.throws(()=>document.info(-1),e=>e.code==='pdf_page_invalid');checks++
 assert.throws(()=>document.search(0,'',false,false,1),e=>e.code==='pdf_search_invalid');checks++
 const plan = [{index:3,rotation:1},{width:595,height:842,rotation:0},{index:1,rotation:0},{index:3,rotation:2}]
 check(document.canEditPages, 'Unencrypted unsigned PDF can be edited')
 const edited = await PDFiumDocument.open(new Uint8Array(document.editPages(plan,20,1024*1024)),wasmUrl)
 try {
  check(edited.pageSizes().every((size,index)=>size.width===edited.info(index).width&&size.height===edited.info(index).height),'Bulk geometry preserves rotated and mixed-size pages')
  check(edited.pageCount===4 && edited.text(0,false).text.includes('page 4') && edited.text(2,false).text.includes('page 2'),'Edited PDF preserves selectable text in its new order')
  check(edited.text(1,false).text==='' && edited.info(1).width===595 && edited.info(1).height===842,'Blank page has the requested position and dimensions')
  check(edited.info(0).rotation===90 && edited.info(3).rotation===180 && edited.text(3,false).text.includes('page 4'),'Duplicated pages rotate independently')
  check(document.text(0,false).text.includes('page 1') && document.info(0).rotation===0,'Output generation leaves the opened source untouched')
 } finally { edited.destroy() }
 const blank = await PDFiumDocument.open(new Uint8Array(document.editPages([{width:612,height:792,rotation:1}],20,1024*1024)),wasmUrl)
 try { check(blank.pageCount===1 && blank.info(0).width===792 && blank.text(0,false).text==='', 'All original pages can be replaced by a blank page') }
 finally { blank.destroy() }
 for (const invalid of [[], [{index:4,rotation:0}], [{index:0,rotation:4}], [{width:NaN,height:100,rotation:0}]]) {
  assert.throws(()=>document.editPages(invalid,20,1024*1024),RangeError);checks++
 }
 assert.throws(()=>document.editPages(plan,20,128),error=>error.code==='pdf_size_limit');checks++
 const rgba = new Uint8Array(32*32*4)
 for(let y=2;y<10;y++)for(let x=2;x<10;x++){const i=(y*32+x)*4;rgba[i]=255;rgba[i+3]=255}
 const exported=await PDFiumDocument.open(new Uint8Array(document.exportPDF([{index:1,width:32,height:32,rgba:rgba.buffer}],1024*1024)),wasmUrl)
 try{
  check(exported.pageCount===4&&exported.text(1,false).text.includes('page 2'),'Annotated export preserves page count and selectable text')
  const raster=new Uint8Array(exported.render(1,96,96).rgba), pixel=(y,x)=>Array.from(raster.slice((y*96+x)*4,(y*96+x)*4+4))
  check(pixel(15,15)[0]>200&&pixel(15,15)[1]<40&&pixel(80,80)[1]>200,'Only annotation pixels are composited over the document')
 }finally{exported.destroy()}
 check(Buffer.from(document.getBytes()).equals(bytes),'Original download returns byte-identical PDF')
 console.log(JSON.stringify({checks,engine:'PDFium',pageCount:4,renderMs,totalMs:performance.now()-start,note:'Local fixture, not a large-document or device benchmark'}))
} finally {document.destroy()}
await assert.rejects(PDFiumDocument.open(bytes,wasmUrl,'',2),e=>e.code==='pdf_page_limit');checks++
await assert.rejects(PDFiumDocument.open(new TextEncoder().encode('not a PDF'),wasmUrl),e=>e.code==='pdf_invalid');checks++
await assert.rejects(openPDF({source:bytes,workerUrl:'/worker',wasmUrl,maxBytes:0}),RangeError);checks++
const controller=new AbortController();controller.abort()
await assert.rejects(openPDF({source:bytes,workerUrl:'/worker',wasmUrl,signal:controller.signal}),{name:'AbortError'});checks++
console.log(JSON.stringify({checks,limits:true,invalidDocument:true,cancellation:true}))
function fixture(scaled=false) {
 const stream='1 0 0 rg 0 0 200 300 re f 0 0 0 rg BT '+(scaled?'/F1 1 Tf 18 0 0 18 20 240 Tm':'/F1 12 Tf 20 250 Td')+' (Example text) Tj ET'
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Rotate ${scaled?0:90} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [8 0 R 9 0 R] >>`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Outlines /First 7 0 R /Last 7 0 R /Count 1 >>',
  '<< /Title (Overview) /Parent 6 0 R /Dest [3 0 R /Fit] >>',
  '<< /Type /Annot /Subtype /Link /Rect [20 20 100 40] /A << /S /URI /URI (https://example.com/) >> >>',
  '<< /Type /Annot /Subtype /Link /Rect [20 60 100 80] /A << /S /URI /URI (javascript:alert) >> >>',
  '<< /Title (SDK fixture) /Author (FLEX) >>',
 ]
 let result='%PDF-1.7\n';const offsets=[0]
 objects.forEach((value,index)=>{offsets.push(result.length);result+=`${index+1} 0 obj\n${value}\nendobj\n`})
 const xref=result.length
 result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`
 result+=offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')
 result+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info 10 0 R >>\nstartxref\n${xref}\n%%EOF`
 return new TextEncoder().encode(result)
}
const complex=await PDFiumDocument.open(fixture(),wasmUrl)
try {
 const info=complex.info(0)
 check(info.rotation===90&&info.width===300&&info.height===200,'Intrinsic page rotation')
 check(complex.metadata().title==='SDK fixture'&&complex.metadata().author==='FLEX','Actual UTF-16 metadata decoding')
 const outline=complex.outline()
 check(outline.length===1&&outline[0].title==='Overview'&&outline[0].pageIndex===0,'Actual bookmark title and destination')
 const links=complex.links(0)
 check(links.length===1&&links[0].url==='https://example.com/','Unsafe document link schemes excluded')
 check(links[0].width>0&&links[0].height>0&&links[0].x>=0&&links[0].y>=0,'Link coordinates on rotated page')
 const pixels=new Uint8Array(complex.render(0,300,200).rgba)
 check(pixels[0]>200&&pixels[1]<20&&pixels[2]<20&&pixels[3]===255,'BGRA converted to correct RGBA colors')
 check(complex.text(0,true).glyphs.every(g=>g.x>=0&&g.y>=0&&g.x<=1&&g.y<=1),'Rotated selectable text geometry')
 console.log(JSON.stringify({checks,rotation:true,outline:true,linkFiltering:true,metadata:true,colorChannels:true}))
} finally{complex.destroy()}
const scaled=await PDFiumDocument.open(fixture(true),wasmUrl)
try{
 const source=scaled.textBlocks(0)[0]
 assert.equal(source.appearance.size,18,'The font size includes its PDF transform')
 assert(source.characters.length>0&&source.characters.at(-1).end===source.text.length,'Original glyph geometry uses textarea UTF-16 offsets')
 assert(source.characters.every(character=>character.endX>character.x&&character.height>0),'Native caret advances must follow the embedded font')
 const flow=[{pageIndex:0,index:source.index,original:source.text,remove:true},
  {pageIndex:0,position:[source.x,source.y],fontSource:source.index,text:'Example text Example text',flow:{width:.55,lineHeight:.08}}]
 const preview=scaled.previewText(0,flow,200,300)
 assert(preview.layouts[0].characters.length>0)
 assert.equal(preview.layouts[0].characters.at(-1).end,flow[1].text.length,'Wrapped geometry preserves input offsets across line breaks')
 const result=await PDFiumDocument.open(new Uint8Array(scaled.editText(flow,1048576)),wasmUrl)
 try{
  const lines=result.textBlocks(0)
  assert(lines.length>=2)
  assert(lines.every(line=>Math.abs(line.appearance.size-18)<.001&&line.width<=.55005),'Wrapping preserves the transformed font and chosen width')
  assert(preview.layouts[0].height>=source.height,'The engine geometry cannot collapse a scaled-font paragraph')
 }finally{result.destroy()}
 console.log(JSON.stringify({scaledFontSize:true,scaledFontReflow:true,nativeParagraphHeight:true}))
}finally{scaled.destroy()}
