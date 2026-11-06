export interface ViewerStylesOptions {
    /** Directory that serves the built viewer.css and heroui.css files. */
    assetBaseUrl?: string | URL
    /** Additional stylesheets, applied in the supplied cascade order inside the viewer. */
    styleSheets?: readonly (string | URL)[]
}

interface PropertyStyles {
    link: HTMLLinkElement
    ready: Promise<void>
    owners: number
}
const propertyStyles = new WeakMap<Document, Map<string, PropertyStyles>>()

/** Only framework @property registrations enter the document; all visual CSS stays isolated. */
function acquirePropertyStyles(document: Document, url: URL, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason)
    let entries = propertyStyles.get(document)
    if (!entries) {entries = new Map(); propertyStyles.set(document, entries)}
    let entry = entries.get(url.href)
    if (!entry) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'; link.href = url.href; link.dataset.fmProperties = ''
        const ready = new Promise<void>((resolve, reject) => {
            link.onload = () => {link.onload = link.onerror = null; resolve()}
            link.onerror = () => {link.onload = link.onerror = null; reject(new Error('Could not load viewer property registrations: ' + url.href))}
        })
        entry = {link, ready, owners: 0}; entries.set(url.href, entry)
        document.head.append(link)
    }
    entry.owners++
    const lease = entry
    let released = false
    const release = () => {
        if (released) return
        released = true; signal.removeEventListener('abort', release)
        if (--lease.owners === 0) {lease.link.remove(); entries!.delete(url.href)}
    }
    signal.addEventListener('abort', release, {once: true})
    return lease.ready.catch(error => {release(); throw error})
}

export function attachViewerStyles(shadow: ShadowRoot, options: ViewerStylesOptions, signal: AbortSignal) {
    const owner = shadow.ownerDocument
    const base = options.assetBaseUrl === undefined ? new URL('./', import.meta.url) : new URL(options.assetBaseUrl, owner.baseURI)
    if (!base.pathname.endsWith('/')) base.pathname += '/'
    const load = (url: URL): Promise<void> => new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return }
        const link = owner.createElement('link')
        link.rel = 'stylesheet'
        link.href = url.href
        const finish = (error?: unknown) => {
            link.onload = link.onerror = null
            signal.removeEventListener('abort', abort)
            if (error) { link.remove(); reject(error) } else resolve()
        }
        const abort = () => finish(signal.reason)
        link.onload = () => finish()
        link.onerror = () => finish(new Error('Could not load viewer stylesheet: ' + url.href))
        signal.addEventListener('abort', abort, {once:true})
        shadow.append(link)
    })
    const properties = acquirePropertyStyles(owner, new URL('properties.css', base), signal)
    const hero = load(new URL('heroui.css', base))
    const viewer = load(new URL('viewer.css', base))
    const custom = (options.styleSheets ?? []).map(url => load(new URL(url, owner.baseURI)))
    return { viewer, ready: Promise.all([properties, hero, viewer, ...custom]) }
}
