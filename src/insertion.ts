import type { Annotation } from './types.js'

export type InsertKind = 'link' | 'image' | 'signature'
export type InsertData = Pick<Annotation, 'asset' | 'href' | 'targetPage'> & {aspectRatio?: number}
export interface InsertOptions {
    owner: HTMLElement
    kind: InsertKind
    pageCount?: number
    dark?: boolean
    signal?: AbortSignal
    labels?: Record<string, string>
    assetBaseUrl?: string | URL
}

export async function imageAnnotationAsset(file: File, owner: Document): Promise<string> {
    if (file.size === 0 || file.size > 5 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Invalid image')
    const source = URL.createObjectURL(file)
    try {
        const image = owner.createElement('img')
        image.src = source
        await image.decode()
        if (image.naturalWidth * image.naturalHeight > 20000000) throw new Error('Image dimensions exceed the limit')
        const canvas = owner.createElement('canvas')
        let scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight))
        for (let attempt = 0; attempt < 4; attempt++) {
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
            canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
            const data = canvas.toDataURL('image/webp', .82)
            if (data.length <= 196608) return data
            scale *= .72
        }
        throw new Error('Image exceeds the annotation size limit')
    } finally { URL.revokeObjectURL(source) }
}

export function openAnnotationInsertDialog({owner, kind, pageCount = 0, dark = false, signal, labels = {}, assetBaseUrl}: InsertOptions): Promise<InsertData | null> {
    if (signal?.aborted) return Promise.resolve(null)
    if (kind === 'signature') return import('./signature-dialog.js').then(({openSignatureDialog}) => openSignatureDialog({owner, kind, pageCount, dark, signal, labels, assetBaseUrl}))
    return import('./insert-dialog.js').then(({openInsertDialog})=>openInsertDialog({owner,kind,pageCount,dark,signal,labels,assetBaseUrl}))
}
