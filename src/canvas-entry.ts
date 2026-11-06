import {mountMediaViewer, type MediaViewerOptions} from './viewer.js'
import {openMediaViewerModal} from './modal.js'
import type {PDFOptions} from './pdf.js'

export type CanvasOptions = Omit<MediaViewerOptions, 'source'> & {
    source: {kind: 'image'; url: string} | {
        kind: 'pdf'
        source: string | Uint8Array
        pdf?: Partial<Omit<PDFOptions, 'source' | 'signal'>>
    }
}

/** The directory containing viewer.css, heroui.css and the fonts directory. */
export function canvasAssets(base: string | URL = new URL('./', import.meta.url)) {
    const url = new URL(base, globalThis.location?.href ?? import.meta.url)
    if (!url.pathname.endsWith('/')) url.pathname += '/'
    return Object.freeze({
        assetBaseUrl: url.href,
        workerUrl: new URL('../pdfium-worker.js', url).href,
        wasmUrl: new URL('../pdfium.wasm', url).href,
        redactionFontUrl: new URL('../redaction-regular.ttf', url).href,
    })
}

function prepare(options: CanvasOptions): MediaViewerOptions {
    const assets = canvasAssets(options.assetBaseUrl)
    return {
        ...options,
        assetBaseUrl: assets.assetBaseUrl,
        source: options.source.kind === 'image' ? options.source : {
            ...options.source,
            pdf: {workerUrl: assets.workerUrl, wasmUrl: assets.wasmUrl, redactionFontUrl: assets.redactionFontUrl, ...options.source.pdf},
        },
    }
}

/** Opens an owned fullscreen viewer, resolving bundled CSS and PDF resources. */
export function openCanvas(options: CanvasOptions, owner: Document = document) {
    return openMediaViewerModal(prepare(options), owner)
}

/** Embeds the same SDK interface inside an application-owned container. */
export function mountCanvas(container: HTMLElement, options: CanvasOptions) {
    return mountMediaViewer(container, prepare(options))
}
