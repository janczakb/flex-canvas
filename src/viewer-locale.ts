type Messages = Readonly<Record<string, string>>
export type ViewerTranslations = Readonly<Record<string, Messages | (() => Promise<Messages>)>>

const loaders: Readonly<Record<string, () => Promise<{ default: Messages }>>> = {
    en: () => import('./locales/en.js'),
    pl: () => import('./locales/pl.js'),
}
const aliases: Readonly<Record<string, string>> = {
    "viewer": "toolbar",
    "annotationLayer": "canvas",
    "loading": "loading_document",
    "error": "save_failed",
    "prev": "previous",
    "zoomIn": "zoom_in",
    "zoomOut": "zoom_out",
    "annotations": "objects",
    "download": "export",
    "original": "pdf-original",
    "annotated": "pdf",
    "edit-pages": "pdf_editor",
    "delete": "remove",
    "deleteConfirm": "delete_question",
    "clearConfirm": "clear_question",
    "eraseConfirm": "erase_question",
    "resize": "resize_sidebar",
    "newPage": "pdf_editor_new_page",
    "deletePages": "pdf_editor_delete",
    "deletePagesConfirm": "pdf_editor_delete_question",
    "rotateLeft": "pdf_editor_rotate_left",
    "rotateRight": "pdf_editor_rotate_right",
    "movePages": "pdf_editor_move",
    "replacePdf": "pdf_editor_save",
    "signature": "signature",
    "textTools": "text"
}

export async function viewerLocale(locale: string | undefined, defaults: Messages, overrides: Messages = {}, translations: ViewerTranslations = {}): Promise<Record<string, string>> {
    const requested = locale?.trim().replaceAll('_', '-') || 'en'
    const base = requested.toLowerCase().split('-')[0]
    const fallback = (await loaders.en()).default
    const catalog = base !== 'en' && Object.hasOwn(loaders, base) ? (await loaders[base]()).default : fallback
    const custom = [requested, base].find(key => Object.hasOwn(translations, key))
    const source = custom ? translations[custom] : undefined
    const supplied = typeof source === 'function' ? await source() : source
    const messages = { ...catalog, ...supplied, ...overrides }
    const labels = { ...fallback, ...messages }
    for (const [key, label] of Object.entries(defaults)) {
        const alias = aliases[key]
        labels[key] = messages[key] ?? (alias ? messages[alias] : undefined)
            ?? fallback[key] ?? (alias ? fallback[alias] : undefined) ?? label
    }
    return labels
}
