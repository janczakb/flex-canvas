const fontNames = ['Dancing Script', 'Allura', 'Sacramento', 'Kalam'] as const
export {fontNames as signatureFonts}

type Lease = {link: HTMLLinkElement; users: number; ready: Promise<void>; cancel: () => void}
const documents = new WeakMap<Document, Map<string, Lease>>()

/** Fonts are self-hosted and shared only while a signature dialog needs them. */
export function acquireSignatureFonts(document: Document, base: string | URL | undefined) {
    const directory = base === undefined ? new URL('./', import.meta.url) : new URL(base, document.baseURI)
    if (!directory.pathname.endsWith('/')) directory.pathname += '/'
    const href = new URL('fonts/fonts-97eafc8d933cb6f7.css', directory).href
    let leases = documents.get(document)
    if (!leases) {leases = new Map(); documents.set(document, leases)}
    let lease = leases.get(href)
    if (!lease) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'; link.href = href; link.dataset.fmSignatureFonts = ''
        let cancel = () => {}
        const ready = new Promise<void>((resolve, reject) => {
            let settled = false
            const finish = (error?: Error) => {
                if (settled) return
                settled = true; link.onload = link.onerror = null
                if (error) reject(error); else resolve()
            }
            cancel = () => finish(new DOMException('Signature closed', 'AbortError'))
            link.onload = () => finish()
            link.onerror = () => finish(new Error('Signature fonts could not be loaded'))
        }).then(async () => {
            await Promise.all(fontNames.map(name => document.fonts.load(`400 32px "FM Signature ${name}"`, 'Signature')))
        })
        lease = {link, users: 0, ready, cancel}
        leases.set(href, lease); document.head.append(link)
    }
    lease.users++
    let released = false
    return {
        ready: lease.ready,
        release() {
            if (released) return
            released = true
            if (--lease.users === 0) {lease.cancel(); lease.link.remove(); leases.delete(href)}
        },
    }
}
