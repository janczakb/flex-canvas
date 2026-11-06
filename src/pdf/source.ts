import { PDFEngineError } from './types.js'

export async function readBoundedBytes(url: string, maxBytes: number, options: RequestInit = {}): Promise<Uint8Array> {
    const response = await fetch(url, { ...options, redirect: 'error' })
    if (!response.ok) throw new PDFEngineError('pdf_fetch_failed', 'Unable to load the document resource.')
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel()
        throw new PDFEngineError('pdf_size_limit', 'The document resource exceeds the byte limit.')
    }
    if (!response.body) throw new PDFEngineError('pdf_fetch_failed', 'The document resource has no body.')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > maxBytes) throw new PDFEngineError('pdf_size_limit', 'The document resource exceeds the byte limit.')
            chunks.push(value)
        }
    } catch (error) { await reader.cancel().catch(() => {}); throw error }
    finally { reader.releaseLock() }
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
