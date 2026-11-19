import { PDFEngineError } from './types.js'

export async function readBoundedBytes(url: string, maxBytes: number, options: RequestInit = {}, onProgress?:(loaded:number,total:number|null)=>void): Promise<Uint8Array> {
    const response = await fetch(url, { ...options, redirect: 'error' })
    if (!response.ok) throw new PDFEngineError('pdf_fetch_failed', 'Unable to load the document resource.')
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel()
        throw new PDFEngineError('pdf_size_limit', 'The document resource exceeds the byte limit.')
    }
    if (!response.body) throw new PDFEngineError('pdf_fetch_failed', 'The document resource has no body.')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    // Content-Length counts compressed transport bytes when Content-Encoding is present.
    let contiguous=Number.isSafeInteger(declared)&&declared>0&&!response.headers.get('content-encoding')?new Uint8Array(declared):undefined
    let size = 0
    const total=contiguous?.length??null
    onProgress?.(0,total)
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > maxBytes) throw new PDFEngineError('pdf_size_limit', 'The document resource exceeds the byte limit.')
            onProgress?.(size,total)
            if(contiguous&&size<=contiguous.length)contiguous.set(value,size-value.byteLength)
            else {
                if(contiguous){chunks.push(contiguous.subarray(0,size-value.byteLength));contiguous=undefined}
                chunks.push(value)
            }
        }
    } catch (error) { await reader.cancel().catch(() => {}); throw error }
    finally { reader.releaseLock() }
    if(contiguous)return size===contiguous.length?contiguous:contiguous.slice(0,size)
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes
}

export function integerLimit(value: number | undefined, fallback: number, min: number, max: number): number {
    const resolved = value ?? fallback
    if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new RangeError('Invalid PDF resource limit')
    return resolved
}
