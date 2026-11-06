import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {PDFiumDocument} from '../dist/pdf/engine.js'
import {pdfSelectionLines} from '../dist/pdf/text-lines.js'
import {validatePDFRedactions} from '../dist/pdf/redactions.js'
const require=createRequire(import.meta.url),wasm='data:application/wasm;base64,'+fs.readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')).toString('base64')
const doc=await PDFiumDocument.open(fs.readFileSync('examples/assets/sample.pdf'),wasm)
try{
 const line=pdfSelectionLines(doc.text(0,true))[0]
 const area=[line.x,line.y,line.width,line.height]
 for(const overlayText of ['', 'REDACTED', 'Zażółć gęślą jaźń']){
  const output=doc.applyRedactions([{pageIndex:0,rectangles:[area],overlayText,fill:'#000000',overlayColor:'#ffffff'}],10485760,fs.readFileSync('assets/redaction-font/regular.ttf'))
  const redacted=await PDFiumDocument.open(new Uint8Array(output),wasm)
  try{
   const text=redacted.text(0,true).text
   assert(!text.includes('FLEX project review'),'Redacted heading must be removed from extracted PDF text')
   assert.equal(redacted.search(0,'FLEX project review',false,false,100).length,0,'Redacted text must not remain searchable')
   assert(doc.text(0,false).text.includes('FLEX project review'),'Working copy must preserve original until accepted')
   assert(redacted.text(1,false).text.includes('FLEX project review'),'Other pages must retain their content')
   const raster=redacted.render(0,612,792),pixels=new Uint8Array(raster.rgba)
   const x=Math.floor((area[0]+area[2]*.01)*612),y=Math.floor((area[1]+area[3]*.1)*792),offset=(y*612+x)*4
   assert(pixels[offset]<20&&pixels[offset+1]<20&&pixels[offset+2]<20,'Applied redaction must render a black fill')
   if(overlayText)assert(text.includes(overlayText),'Overlay label must be actual replacement PDF text')
   if(overlayText==='Zażółć gęślą jaźń'){
    const block=redacted.textBlocks(0).find(block=>block.text===overlayText)
    assert(block?.font.includes('NotoSans'),JSON.stringify(block))
    const edit={pageIndex:0,index:block.index,original:block.text,text:'gęślą'}
    const preview=redacted.previewText(0,[edit],612,792)
    const committed=await PDFiumDocument.open(new Uint8Array(redacted.editText([edit],10485760)),wasm)
    try{
     assert.equal(committed.textBlocks(0).find(item=>item.text===edit.text)?.font,block.font)
     assert(redacted.text(0,false).text.includes(overlayText),'Preview cannot change the source')
     const full=new Uint8Array(committed.render(0,612,792).rgba),live=new Uint8Array(preview.rgba)
     const x=Math.round(preview.x*612),y=Math.round(preview.y*792)
     for(let row=0;row<preview.height;row++){
      const offset=((y+row)*612+x)*4
      assert.deepEqual(live.subarray(row*preview.width*4,(row+1)*preview.width*4),full.subarray(offset,offset+preview.width*4))
     }
    }finally{committed.destroy()}
    for(const width of [.15,.25]){
     const flow=[{pageIndex:0,index:block.index,original:block.text,remove:true},
      {pageIndex:0,position:[block.x,.72],fontSource:block.index,text:'gęślą gęślą gęślą gęślą gęślą gęślą',flow:{width,lineHeight:.025}}]
     const live=redacted.previewText(0,flow,612,792),saved=await PDFiumDocument.open(new Uint8Array(redacted.editText(flow,10485760)),wasm)
     try{
      const wrapped=saved.textBlocks(0).filter(item=>item.font===block.font)
      assert.equal(wrapped.map(item=>item.text).join(' ').match(/gęślą/g)?.length,6,'Reflow must preserve every word exactly once')
      assert(wrapped.length>1,'Long text must wrap using the embedded PDF font')
      assert(wrapped.every(item=>item.width<=width+.00005),'Every native line stays within the chosen width')
      assert(wrapped.every(item=>item.x+item.width<=block.x+width+.002),'The wrapped paragraph must stay inside its right edge')
      assert.equal(live.layouts[0].width,width)
      assert(live.layouts[0].height>=wrapped.length*.025)
      const pixels=new Uint8Array(saved.render(0,612,792).rgba),preview=new Uint8Array(live.rgba)
      const x=Math.round(live.x*612),y=Math.round(live.y*792)
      for(let row=0;row<live.height;row++){
       const offset=((y+row)*612+x)*4
       assert.deepEqual(preview.subarray(row*live.width*4,(row+1)*live.width*4),pixels.subarray(offset,offset+live.width*4))
      }
     }finally{saved.destroy()}
    }
   }
  }finally{redacted.destroy()}
 }
 for(const rotation of [1,2,3]){
  const bytes=doc.editPages([{index:0,rotation}],4,10485760),rotated=await PDFiumDocument.open(new Uint8Array(bytes),wasm)
  try{
   const all=rotated.text(0,true).glyphs, start=all.map(g=>g.text).join('').indexOf('FLEX project')
   assert(start>=0)
   const glyphs=all.slice(start,start+'FLEX project'.length),left=Math.min(...glyphs.map(g=>g.selection.x)),top=Math.min(...glyphs.map(g=>g.selection.y)),right=Math.max(...glyphs.map(g=>g.selection.x+g.selection.width)),bottom=Math.max(...glyphs.map(g=>g.selection.y+g.selection.height))
   const output=rotated.applyRedactions([{pageIndex:0,rectangles:[[left,top,right-left,bottom-top]]}],10485760),result=await PDFiumDocument.open(new Uint8Array(output),wasm)
   try{assert(!result.text(0,false).text.includes('FLEX project'));assert.equal(result.info(0).rotation,rotation*90)}finally{result.destroy()}
  }finally{rotated.destroy()}
 }
 assert.throws(()=>doc.applyRedactions([{pageIndex:0,rectangles:[area]}],10),/byte limit/)
 assert(doc.text(0,false).text.includes('FLEX project review'),'Failed output admission must not mutate the source')
 assert.throws(()=>doc.applyRedactions([{pageIndex:0,rectangles:[area],overlayText:'Zażółć'}],10485760),/compatible font/)
 for(const mask of [[],[{pageIndex:4,rectangles:[area]}],[{pageIndex:0,rectangles:[[.9,.1,.5,.1]]}],[{pageIndex:0,rectangles:[area],overlayText:'x\0y'}]])assert.throws(()=>validatePDFRedactions(mask,4),RangeError)
 console.log(JSON.stringify({nativeContentRemoved:true,searchRemoved:true,sourcePreservedUntilAccept:true,otherPagesPreserved:true,blackRaster:true,overlayText:true,liveEmbeddedFontMatchesSavedRaster:true,invalidInputRejected:4}))
}finally{doc.destroy()}
