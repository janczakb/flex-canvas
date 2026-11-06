import { PDFiumDocument } from './engine.js'
import type { PDFRequest, PDFResponse } from './protocol.js'

const scope = globalThis as unknown as {onmessage: ((event: MessageEvent<PDFRequest>) => void) | null; postMessage(message: PDFResponse, transfer?: Transferable[]): void}
let document: PDFiumDocument | undefined, queue = Promise.resolve(), pending = 0, maxPages = 0
let runtime: {url:string; api:ReturnType<typeof PDFiumDocument.prepare>}|undefined
scope.onmessage = ({data}) => {
    if (!data || !Number.isSafeInteger(data.id)) return
    if (++pending > 32) { pending--; scope.postMessage({id: data.id, ok: false, code: 'pdf_queue_limit'}); return }
    queue = queue.then(async () => {
        try {
            let value: unknown
            if (data.method === 'prepare') {
                if (document || typeof data.input.wasmUrl !== 'string') throw new Error('Invalid PDF runtime')
                if (runtime?.url !== data.input.wasmUrl) runtime={url:data.input.wasmUrl,api:PDFiumDocument.prepare(data.input.wasmUrl)}
                await runtime.api
                value=true
            } else if (data.method === 'open') {
                if (document) throw new Error('Document already open')
                const input = data.input
                if (!(input.bytes instanceof ArrayBuffer) || input.bytes.byteLength > 104857600 || typeof input.wasmUrl !== 'string' || typeof input.password !== 'string' || input.password.length > 1024 || !Number.isSafeInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 10000) throw new Error('Invalid PDF input')
                document = await PDFiumDocument.open(new Uint8Array(input.bytes), input.wasmUrl, input.password, input.maxPages, runtime?.url===input.wasmUrl?runtime.api:undefined)
                maxPages = input.maxPages
                value = {pageCount: document.pageCount, canEditPages: document.canEditPages}
            } else {
                if (!document) throw new Error('Document not open')
                switch (data.method) {
                    case 'sizes': value = document.pageSizes(); break
                    case 'info': value = document.info(data.input.index); break
                    case 'text': value = document.text(data.input.index, data.input.geometry); break
                    case 'render': value = document.render(data.input.index, data.input.width, data.input.height); break
                    case 'renderTile': value = document.renderTile(data.input.index, data.input.tile); break
                    case 'search': value = document.search(data.input.index, data.input.query, data.input.matchCase, data.input.wholeWord, data.input.limit); break
                    case 'outline': value = document.outline(); break
                    case 'metadata': value = document.metadata(); break
                    case 'bytes': value = document.getBytes(); break
                    case 'textBlocks': value=document.textBlocks(data.input.index);break
                    case 'previewText': value=document.previewText(data.input.index,data.input.edits,data.input.width,data.input.height);break
                    case 'editText':
                        if(!Number.isSafeInteger(data.input.maxBytes)||data.input.maxBytes<1||data.input.maxBytes>104857600)throw new Error('Invalid PDF output budget')
                        value=document.editText(data.input.edits,data.input.maxBytes);break
                    case 'crop':
                        if(!Number.isSafeInteger(data.input.maxBytes)||data.input.maxBytes<1||data.input.maxBytes>104857600)throw new Error('Invalid PDF output budget')
                        value=document.cropPages(data.input.crops,data.input.maxBytes);break
                    case 'redact':
                        if(!Number.isSafeInteger(data.input.maxBytes)||data.input.maxBytes<1||data.input.maxBytes>104857600)throw new Error('Invalid PDF output budget')
                        if(data.input.font!==undefined&&(!(data.input.font instanceof ArrayBuffer)||data.input.font.byteLength>2097152))throw new Error('Invalid redaction font')
                        value=document.applyRedactions(data.input.redactions,data.input.maxBytes,data.input.font?new Uint8Array(data.input.font):undefined);break
                    case 'exportPDF':
                        if (!Number.isSafeInteger(data.input.maxBytes) || data.input.maxBytes < 1 || data.input.maxBytes > 104857600) throw new Error('Invalid PDF output budget')
                        value = document.exportPDF(data.input.overlays, data.input.maxBytes); break
                    case 'editPages':
                        if (!Number.isSafeInteger(data.input.maxBytes) || data.input.maxBytes < 1 || data.input.maxBytes > 104857600) throw new Error('Invalid PDF output budget')
                        value = document.editPages(data.input.pages, maxPages, data.input.maxBytes); break
                    case 'links': value = document.links(data.input.index); break
                    default: throw new Error('Unsupported PDF command')
                }
            }
            const transfer = data.method === 'render' || data.method === 'renderTile' || data.method === 'previewText' ? [(value as {rgba: ArrayBuffer}).rgba] : ['editPages','bytes','exportPDF','redact','crop','editText'].includes(data.method) ? [value as ArrayBuffer] : []
            scope.postMessage({id: data.id, ok: true, value}, transfer)
        } catch (error) {
            // Never send source bytes, URLs, passwords or native engine diagnostics to the UI.
            const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'pdf_operation_failed'
            scope.postMessage({id: data.id, ok: false, code})
        } finally { pending-- }
    })
}
