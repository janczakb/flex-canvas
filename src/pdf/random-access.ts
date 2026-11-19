import {PDFEngineError} from './types.js'
export type PDFSourceDescriptor={kind:'blob';blob:Blob}|{kind:'http';url:string;size:number;etag:string;headers?:Record<string,string>;credentials?:boolean}
export interface PDFRandomAccessSource {size:number;read(offset:number,target:Uint8Array):void;destroy():void}
/** Worker-only synchronous PDFium callbacks. The cache, not the file size, bounds JS bytes. */
export function createRandomAccessSource(source:PDFSourceDescriptor,onProgress?:(loaded:number,total:number)=>void):PDFRandomAccessSource{
 const size=source.kind==='blob'?source.blob.size:source.size,blockSize=256*1024,maxBlocks=64
 if(!Number.isSafeInteger(size)||size<5||size>2147483647)throw new PDFEngineError('pdf_size_limit','Invalid random-access PDF size.')
 const cache=new Map<number,Uint8Array>(),seen=new Set<number>();let loaded=0,closed=false
 const Reader=(globalThis as unknown as {FileReaderSync?:new()=>{readAsArrayBuffer(blob:Blob):ArrayBuffer}}).FileReaderSync
 const reader=source.kind==='blob'&&Reader?new Reader():undefined
 if(source.kind==='blob'&&!reader)throw new PDFEngineError('pdf_random_access_unavailable','Synchronous file reading requires a dedicated worker.')
 const block=(index:number):Uint8Array=>{
  const cached=cache.get(index);if(cached){cache.delete(index);cache.set(index,cached);return cached}
  const start=index*blockSize,end=Math.min(size,start+blockSize)-1
  let bytes:Uint8Array
  if(source.kind==='blob')bytes=new Uint8Array(reader!.readAsArrayBuffer(source.blob.slice(start,end+1)))
  else{
   const request=new XMLHttpRequest();request.open('GET',source.url,false);request.responseType='arraybuffer';request.withCredentials=source.credentials===true
   for(const [key,value] of Object.entries(source.headers??{}))if(!['range','if-range'].includes(key.toLowerCase()))request.setRequestHeader(key,value)
   request.setRequestHeader('Range',`bytes=${start}-${end}`);request.setRequestHeader('If-Range',source.etag)
   try{request.send()}catch{throw new PDFEngineError('pdf_range_failed','Unable to read a PDF block.')}
   const range=`bytes ${start}-${end}/${size}`
   if(request.status!==206||request.getResponseHeader('Content-Range')!==range||new URL(request.responseURL).href!==source.url||request.getResponseHeader('ETag')!==source.etag)throw new PDFEngineError('pdf_range_changed','The PDF source changed or range delivery failed.')
   bytes=new Uint8Array(request.response)
  }
  if(bytes.byteLength!==end-start+1)throw new PDFEngineError('pdf_range_failed','Incomplete PDF block.')
  cache.set(index,bytes);while(cache.size>maxBlocks)cache.delete(cache.keys().next().value!)
  if(!seen.has(index)){seen.add(index);loaded+=bytes.byteLength;onProgress?.(loaded,size)}
  return bytes
 }
 return {size,read(offset,target){
  if(closed||!Number.isSafeInteger(offset)||offset<0||offset+target.length>size)throw new PDFEngineError('pdf_range_failed','Invalid PDF block request.')
  let written=0
  while(written<target.length){const position=offset+written,index=Math.floor(position/blockSize),data=block(index),inside=position%blockSize,count=Math.min(target.length-written,data.length-inside);target.set(data.subarray(inside,inside+count),written);written+=count}
 },destroy(){closed=true;cache.clear();seen.clear()}}
}

/** Probe only a byte; auto mode falls back if stable range identity cannot be verified. */
export async function probePDFRange(url:string,maxBytes:number,options:{headers?:Record<string,string>;withCredentials?:boolean;signal:AbortSignal}):Promise<PDFSourceDescriptor|undefined>{
 const resource=new URL(url,globalThis.location?.href);resource.hash='';const normalized=resource.href
 if(!/^https?:/.test(normalized))return undefined
 const headers=new Headers(options.headers);headers.set('Range','bytes=0-0')
 const response=await fetch(normalized,{headers,signal:options.signal,credentials:options.withCredentials?'include':'same-origin',redirect:'error'})
 try{
  const match=/^bytes 0-0\/(\d+)$/.exec(response.headers.get('content-range')??''),etag=response.headers.get('etag'),size=Number(match?.[1])
  if(response.status!==206||!match||!etag||etag.startsWith('W/')||response.headers.get('content-encoding')&&!['identity'].includes(response.headers.get('content-encoding')!))return undefined
  if(size>maxBytes)throw new PDFEngineError('pdf_size_limit','PDF source exceeds the byte limit.')
  return {kind:'http',url:normalized,size,etag,headers:options.headers,credentials:options.withCredentials}
 }finally{await response.body?.cancel()}
}
