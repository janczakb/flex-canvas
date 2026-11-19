import assert from 'node:assert/strict'
import {readBoundedBytes} from '../dist/pdf/source.js'
const original=globalThis.fetch
try{
 for(const [length,encoding] of [[6,null],[2,null],[10,null],[null,null],[2,'gzip']]){
  globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]));controller.enqueue(new Uint8Array([4,5,6]));controller.close()}}),{headers:{...(length===null?{}:{'content-length':String(length)}),...(encoding?{'content-encoding':encoding}:{})}})
  assert.deepEqual([...await readBoundedBytes('/test',20)],[1,2,3,4,5,6])
 }
 globalThis.fetch=async()=>new Response(new Uint8Array(21))
 await assert.rejects(readBoundedBytes('/large',20),error=>error.code==='pdf_size_limit')
 globalThis.fetch=async()=>new Response(new Uint8Array(1),{status:403})
 await assert.rejects(readBoundedBytes('/private',20),error=>error.code==='pdf_fetch_failed')
 console.log(JSON.stringify({declaredUnknownCompressedAndMisreportedLengths:5,byteLimit:true,httpErrors:true}))
}finally{globalThis.fetch=original}
