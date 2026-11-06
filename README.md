# FLEX Canvas

**Image and PDF viewing, annotation and document editing for the web.**

[![CI](https://github.com/janczakb/flex-canvas/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/janczakb/flex-canvas/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@useflex/canvas)](https://www.npmjs.com/package/@useflex/canvas)

[npm](https://www.npmjs.com/package/@useflex/canvas) ·
[Source](https://github.com/janczakb/flex-canvas) ·
[Issues](https://github.com/janczakb/flex-canvas/issues) ·
[Discussions](https://github.com/janczakb/flex-canvas/discussions) ·
[Changelog](./CHANGELOG.md)

Add a complete document workspace to your application: review images, mark up PDF
text, capture signatures and organize pages. Open it in a fullscreen modal or
embed it in your own layout. FLEX Canvas works independently of Laravel and
Filament, with TypeScript types and a browser bundle that includes its UI runtime.

- **Images and PDFs:** one interface, separate annotation layers and configurable read-only mode.
- **Review tools:** shapes, freehand drawing, highlights, notes, numbered pins, text, callouts, images, links and visual signatures.
- **PDF workspace:** selectable text, search, outlines, bookmarks, thumbnails, single or double pages and continuous scrolling.
- **Document changes:** reorder, duplicate, insert, rotate, crop, edit supported text objects and apply redactions to a working PDF revision.
- **Rendering:** PDFium in a worker, prioritized visible tiles, bounded raster caches and virtualized thumbnails.
- **Application control:** choose the tools, theme, language and persistence callbacks. Your server owns storage and access rules.

## Start with a script tag

No build step or React installation is needed for this version-pinned CDN entry.
The loader imports the UI when first used; the PDF worker and WebAssembly load
only when a PDF is opened. The SDK loads its separate CSS files automatically.

```html
<button id="open-document">Open document</button>
<script src="https://cdn.jsdelivr.net/npm/@useflex/canvas@0.1.0/dist/flex-canvas.js"></script>
<script>
  document.querySelector('#open-document').addEventListener('click', async () => {
    const viewer = await FlexCanvas.open({
      name: 'Project brochure',
      source: {kind: 'pdf', source: '/documents/brochure.pdf'},
      mode: 'read',
      theme: 'light',
    });
    // await viewer.requestClose(); // Confirms unsaved changes when necessary.
    // await viewer.destroy();      // Disposes the viewer programmatically.
  });
</script>
```

`FlexCanvas.open(options)` opens a fullscreen modal.
`FlexCanvas.mount(element, options)` embeds the viewer.
`await FlexCanvas.ready()` returns the complete ESM API for advanced usage.
Use a same-origin document URL or a server that permits CORS. Private document
credentials belong to your application, never to a public CDN URL.

## Use ES modules

```html
<script type="module">
  import {openCanvas} from 'https://cdn.jsdelivr.net/npm/@useflex/canvas@0.1.0/dist/browser/index.js';

  document.querySelector('#open-image').addEventListener('click', async () => {
    await openCanvas({
      name: 'Site inspection',
      source: {kind: 'image', url: '/photos/inspection.jpg'},
      saveAnnotations: async (annotations, signal) => {
        const response = await fetch('/api/documents/42/annotations', {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({annotations}),
          signal,
        });
        if (!response.ok) throw new Error('Could not save annotations.');
      },
    });
  });
</script>
```

Provide the `open-image` button in your page. The endpoint is an application
example: implement its authentication, CSRF protection, authorization, revision
checks and annotation validation on your server. Without a save callback, the
annotation layer remains local to the session. Editing an image's annotation layer
does not overwrite the source image. PDF edits affect the working revision;
persist them explicitly with `replacePdf` or download the exported document.

## Install from npm and self-host

```sh
npm install @useflex/canvas
```

```ts
import {mountCanvas} from '@useflex/canvas'

const viewer = await mountCanvas(document.querySelector<HTMLElement>('#viewer')!, {
  source: {kind: 'pdf', source: '/documents/review.pdf'},
  assetBaseUrl: '/vendor/flex-canvas/browser/',
  scrollMode: 'continuous',
  theme: 'auto',
})

// When your application removes the container:
await viewer.destroy()
```

Give `#viewer` a height, for example `height: 80vh`. Copy the complete package
`dist/` directory to `/vendor/flex-canvas/`, preserving its structure, along with
the license notices. This includes the CSS files, fonts, module chunks,
`pdfium-worker.js`, `pdfium.wasm` and `redaction-regular.ttf`. When your bundler
relocates JavaScript, set `assetBaseUrl` explicitly as above. Do not mix assets
from different releases. `canvasAssets(base)` returns the matching default
resource URLs; `source.pdf` can override individual PDF resource options.

The browser must support ES2022, WebAssembly, module workers, Shadow DOM and
Canvas 2D. Cross-origin CDN workers use a small owned Blob bootstrap. With a
Content Security Policy, allow your chosen CDN for scripts, styles, fonts and
connections, and `blob:` in `worker-src`. Self-hosting the worker avoids that
cross-origin bootstrap requirement. Your CSP must also permit WebAssembly
compilation (typically `wasm-unsafe-eval`). Images and documents need the
corresponding image/connection permissions. Preserve your application's nonce
and other protections; this SDK does not change the page's CSP.

## License

FLEX Canvas is **source-available**, with permitted free personal, educational,
research and internal company use. Commercial software products require an
appropriate commercial grant.

**A valid paid FLEX Fields license includes FLEX Canvas at no additional Canvas
license charge, within that license's product and entity scope.** This includes
existing paid customers and standalone use without FLEX Fields or Filament.

Read [LICENSE](./LICENSE) and [COMMERCIAL.md](./COMMERCIAL.md) for the terms and
examples. Third-party components retain their licenses in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and `licenses/`.

## API guide

The following lower-level APIs are also exported for applications that need more
control. Unlike `openCanvas` and `mountCanvas`, `openMediaViewerModal`,
`mountMediaViewer` and `openPDF` expect explicit PDF resource URLs.

## Document commands

```ts
import { createAnnotationDocument } from '@useflex/canvas'

const document = createAnnotationDocument({
  profile: { maxPages: 4, maxShapes: 500 },
})

document.dispatch({
  type: 'add',
  shape: {
    id: crypto.randomUUID(),
    tool: 'rectangle',
    pageIndex: 1,
    color: '#dc2626',
    stroke: 3,
    points: [[0.15, 0.2], [0.7, 0.65]],
    opacity: 0.8,
    fill: 'none',
    dash: 'dashed',
  },
})

const stop = document.subscribe(event => console.log(event.command))
document.dispatch({ type: 'undo' })
document.dispatch({ type: 'redo' })
const json = document.export()
stop()
document.dispose()
```

Coordinates are normalized to the unrotated page/image. Page indices start at
zero. A layer contains geometry and text, never modified source-image bytes.
Snapshots are immutable; all mutations pass through validated commands. Limits
cover tool/color allowlists, geometry, points, UTF-8 text bytes, pages, layer size
and history. The server must independently authorize the document/layer and
validate each submitted change.

## PDFium document adapter

```ts
import { openPDF } from '@useflex/canvas/pdf'

const pdf = await openPDF({
  source: '/documents/review.pdf',
  workerUrl: '/media-viewer/pdfium-worker.js',
  wasmUrl: '/media-viewer/pdfium.wasm',
  maxBytes: 25 * 1024 * 1024,
  maxPages: 500,
  maxCanvasPixels: 4 * 1024 * 1024,
})

await pdf.renderPage(0, canvas, { scale: 1.5 })
const results = await pdf.searchPage(0, 'invoice', { wholeWord: true })
const text = await pdf.getText(0)
const outline = await pdf.getOutline()
await pdf.destroy()
```

The browser worker and WebAssembly are emitted into `dist/` by the SDK build;
self-host them under URLs passed to `openPDF`. Preserve the bundled `licenses/`
notices. No CDN fallback or remote document service is used. The framework host
uses its existing sealed asset release URLs instead.

One worker owns each document. Rendering, PDF parsing and text extraction run in
that worker. The adapter exposes page geometry, selectable text geometry, search,
metadata, bookmarks and sanitized HTTP(S)/mailto links. It bounds input bytes,
page count, queued work, operation duration and raster pixels. Stale render
results cannot paint over a newer page, and closing terminates the worker.
It currently downloads the bounded document before opening; range streaming is
not implemented. The read-only view is not semantic text reflow.

`createPDFThumbnails` uses visibility-based, single-flight thumbnail rendering.
`thumbnailWindow` supplies a bounded DOM window for long documents. The host
provides thumbnail navigation, document outline and search panels.

## Storage

`LayerStorage` supplies `load(signal)` and
`save({ data, revision, operation, signal })`. Persistence is explicit. A retry
of the same snapshot reuses its operation ID. A successful response marks that
snapshot saved while preserving newer local changes. Server-side authorization,
optimistic revision checks and idempotency receipts remain necessary; browser
state is not an authorization mechanism.

## Capabilities

- Immutable document, canonical validation, versioned import/export, bounded undo/redo.
- Rectangle, ellipse, line, arrow, freehand, highlighter, text, numbered pins, notes, polygons and polylines. Legacy stamp data can be read; stamp creation is not offered.
- Stroke/fill/opacity/line-style properties, per-page layers, separate canvas renderer.
- PDFium worker rendering, text extraction/selection, native search, outline, metadata and link APIs.
- Configurable read-only mode, explicit storage adapter, cancellation and owner cleanup.
- PDF page reorder, deletion, duplication, blank-page insertion and rotation with annotation remapping.
- PDF page cropping, editing existing PDF text objects and applying PDF redactions in the browser.
- Prioritized visible PDF tiles, bounded raster caches and virtualized thumbnails.

PDF annotations are stored as a separate document and flattened on export.
Native editable PDF annotations, digital signature fields, importing pages from
another PDF, paragraph reflow and collaborative comment threads are outside
the current scope.

## Notes

Notes use a fixed-size marker and a separate editable popup; they do not resize or
modify source pixels. `noteIcon` supports `comment`, `pointer`, `arrow`, `check`,
`circle`, `cross`, `insert`, `new-paragraph`, `note`, `paragraph`, `help`, `star`
and `key`. A profile can restrict these using `noteIcons: ['comment', 'star']`.
Legacy notes without an icon retain their comment marker. Empty note bodies are
valid, so a marker can be created before typing. Empty free-text annotations and
stamps remain invalid.

Editing a note updates the local annotation layer;
**Save annotations** persists that layer. Dragging a marker moves it, clicking
opens its popup, and clicking outside closes and deselects it. Color and icon
changes apply to the selected note and become defaults for the next note.
The popup is clamped to the visible scroller and flips above bottom-edge markers.
Source decoding and PDF rendering have an absolute skeleton; no readiness delay
or reveal timer is used.

## Line endings

Line, arrow and polyline annotations accept independent `startCap` / `endCap`:
`none`, `square`, `circle`, `diamond`, `open-arrow`, `closed-arrow`, `bar`,
`reverse-open-arrow`, `reverse-closed-arrow`, and `slash`. Restrict these per
profile with `lineEndings`. Closed markers use the annotation's `fill`; `none`
leaves them unfilled. Stroke color/width/opacity and solid/dashed/dotted line
styles remain independent. Legacy arrows without explicit caps keep their open
arrowhead; legacy plain lines keep plain ends.

```ts
session.dispatch({type: 'add', shape: {
  id: 'review-line', tool: 'line', points: [[0.15, 0.2], [0.8, 0.65]],
  color: '#2563eb', stroke: 3, fill: 'none', dash: 'dashed',
  startCap: 'circle', endCap: 'open-arrow',
}})
```

The SDK page control is a joined previous/input/next group. Its plain text
input uses numeric input mode, validates page bounds on commit, supports Enter
and arrow keys and has no native number spinner. Toolbar zoom controls use
bundled Hugeicons ZoomIn/ZoomOut.

## Pointer interaction

The host uses the normal arrow cursor over the image, a pointer over annotations
and directional resize cursors over actual selection handles. Pan uses the
standard grab/grabbing cursor. Hovering a note or numbered pin shows its plain
text preview without focusing the textarea or changing selection. Clicking opens
editing; dragging an existing annotation takes precedence over placing another
object, including when the pin tool remains active. Pins accept optional `text`
under the same configured text-byte limit as notes; older pins remain valid.

Cloudy polygons use clicked vertices and an independent scalloped border with
`cloudIntensity` 1–3, color, stroke, fill and opacity. Enter/double-click or closing
the first vertex finishes the polygon; Escape cancels it. The renderer bounds
scallop subdivision independently of image pixel dimensions. Polygon hit testing
includes their interior; ellipse hit testing does not capture empty box corners.
Hover hit tests are coalesced to animation frames; normalized bounds are cached
against immutable shape snapshots. Source image bytes are never rewritten.

## Ink, selected PDF text and callouts

Drawing (`pen`) and Freeform Highlight (`highlight`) store normalized stroke
points. The optional `eraser` tool modifies these strokes only; it is an editing
command and cannot be stored as an annotation. Configure `eraserMode: 'point'`
(the default, removes only touched portions) or `'stroke'` (removes a touched
stroke), and `eraserSize` between 4 and 128. A complete eraser gesture is one undo
operation; cancellation leaves the document unchanged. Fragment and point limits
remain enforced. PDF text highlights and geometric annotations are unaffected.

`text-highlight` is available only for PDF documents. Its
`rectangles` are normalized `[left, top, width, height]` selections of actual PDF
text, not freehand strokes. The selection is persisted separately from the PDF
and can be selected, recolored or deleted. The host does not drag it away from
its text. The floating search bar supports result navigation without opening a
sidebar or changing document width.

`text` supports an inline text box. `callout` adds a leader: its four points are
text-box top-left, bottom-right, knee and arrow tip. Its box controls and leader
controls are independent. Text is wrapped using the active font's measured
width; committing expands the box vertically when space allows. If it would
leave the page, the editor keeps the draft and asks to move or shorten it.
Ctrl/Command+Enter commits, Escape cancels, and leaving the editor commits.

`annotationControlPoints()` and `moveAnnotationVertex()` expose individual line
endpoints and polygon/cloud/polyline vertices without transforming their other
points. Drawing modes use a size preview circle; selection uses the normal
cursor, object pointer and directional box-resize cursors. No tool changes the
original image. PDF edits produce a working revision or pass it to the
configured storage adapter.

PDF text selection uses consistent line boxes from PDFium, including spaces
between words. The contextual toolbar offers highlight, strikethrough,
underline, squiggly underline, comment and mark for redaction. Configure its
actions with `textMarkupActions`. Comments stay attached to the highlighted
range and open in a popup beside it. A redaction mark previews the target area
with a solid outline. Choose Apply Redactions to remove affected PDF content
from the working revision and apply the configured fill and overlay text.

Repeated markup of the same type selects the existing annotation. Compatible
overlapping ranges merge and a different style is applied only to the uncovered
range. Freeform Highlight starts at 30 pt, full opacity and Multiply, subject
to the instance's stroke limits and `blendModes` allowlist.

### Reorder and replace PDF pages

The PDF adapter exposes `canEditPages` and `editPages`. Pass an ordered list of
source page indices (zero-based) or blank page sizes in PDF points. Rotation
is relative to the source page and measured in clockwise quarter turns.
Repeating a source index duplicates that page.

```ts
const edited = await document.editPages([
  { index: 1, rotation: 0 },
  { width: 595.28, height: 841.89, rotation: 0 },
  { index: 0, rotation: 1 },
])
```

Use the viewer's `replacePdf` callback to persist a changed PDF and its remapped
annotations together. Authorize the document on your server, check its current
revision, validate the submitted file and commit both values atomically. A browser
callback alone does not provide server-side authorization or conflict protection.

## Embed in your application

```ts
import { mountMediaViewer } from '@useflex/canvas'

const viewer = await mountMediaViewer(document.querySelector('#viewer')!, {
  source: {
    kind: 'pdf',
    source: '/documents/review.pdf',
    pdf: {
      workerUrl: '/viewer/pdfium-worker.js',
      wasmUrl: '/viewer/pdfium.wasm',
    },
  },
  mode: 'edit',
  theme: 'auto',
  toolbar: {
    items: ['pages', 'pager', 'pan', 'zoom', 'annotations', 'edit-pages', 'download'],
    tools: ['highlight', 'image', 'link', 'signature'],
    properties: [],
  },
  preserveAnnotations: true,
  pdfOperations: ['pages'],
  replacePdf: async ({ operation, bytes, annotations, plan, signal }) => {
    await documentStore.replace({ operation, bytes, annotations, plan, signal })
  },
})

// On unmount
await viewer.destroy()
```

Give the container a height and serve the worker and WASM from the same SDK
build. The viewer creates its own DOM and styles. Set `mode: 'read'` for a
reader or omit `print` and `download` from the toolbar items to hide those
actions. Use `saveAnnotations` to persist changes to the annotation layer.
`replacePdf` receives the candidate PDF, ordered page plan, and remapped
annotations together. Commit them as one document revision in your storage
adapter. Set `pdfOperations` to the operations that adapter accepts. The
standalone viewer defaults to `pages`, `crop`, `content` and `redactions`.
Download the working revision with `exportPDF()`.

Page order and rotation changes carry annotations with their source pages when
`preserveAnnotations` is enabled. Deleting a page removes its annotations from
the new revision. Crop updates the PDF CropBox and keeps the underlying page
content available. The crop can be applied to one page or proportionally to all
pages. Content Editor analyzes every page before enabling editing. It outlines
editable text on rendered pages and groups compatible lines into paragraphs.
Click a block to edit it in place. A worker renders the draft from the PDF,
using the original font where it supplies the requested glyphs. Save & Close
commits the session together. Explicit font changes offer PDF standard
families. Complex reflow and nested text objects have limited coverage. Drawn,
uploaded and typed signatures appear in the Signatures panel as visual
annotations.

The signature dialog uses HeroUI Modal with its close button and Secondary tabs
for Draw, Image and Type. Typed signatures use Dancing Script, Allura, Sacramento
and Kalam from Google Fonts. All four include Polish letters and extended Latin
characters. Fonts are served locally under the bundled SIL Open Font Licenses;
the browser does not contact Google. They load only when Type is opened.

### Images, language and appearance

Use the same mount function for an image. Image sessions load the drawing
tools and skip the PDF worker and WebAssembly. The annotation layer is
independent of the original image. Export creates a separate PNG.

```ts
const viewer = await mountMediaViewer(container, {
  source: { kind: 'image', url: '/photos/site-inspection.jpg' },
  locale: 'pl-PL',
  translations: {
    pl: async () => (await import('./viewer/pl.js')).default,
  },
  labels: { save: 'Zapisz uwagi' },
  theme: 'light',
  toolbar: {
    items: ['select', 'zoom', 'annotations', 'undo', 'redo', 'delete'],
    tools: ['pin', 'rectangle', 'note'],
    properties: ['color', 'noteIcon'],
  },
  saveAnnotations: (annotations, signal) => inspection.save(annotations, signal),
})

await viewer.setLocale('en')
viewer.setTheme('dark')
```

`theme` is a global viewer option: `'light'`, `'dark'` or `'auto'` (the default).
It controls the workspace, toolbars, panels, popovers and dialogs. In auto mode
it follows changes to the operating system's color scheme. Use `setTheme()` to
change it during a session; `viewer.theme` returns the configured preference.
`toolbar` configures tools and controls only; it has no theme option.

Text annotations support independent font and fill colors, including transparent
fill, alongside opacity and text formatting. Property labels follow the active
tool and the selected annotation: `font_color`, `drawing_color`, `stroke_color`,
`highlight_color`, `note_color` and `pin_color` can be overridden in your locale
dictionary. Compact property buttons use the same translated labels.

### Text and callouts on the page

Choose Text and click the page to start typing, or drag to define a fixed-width
text area. Callout creates a text area and a leader anchored at the clicked point.
Click an existing text area to edit it directly. Its text box can be moved or
resized using the selection handles; the callout also exposes its knee and tip.

The contextual toolbar offers font and background colors, opacity, font family,
size, bold, italic, underline, horizontal alignment and vertical alignment.
Callouts have a separate border/leader color and line width. Changes appear while
you type. Enter inserts a new line; Ctrl/Command+Enter commits the edit; Escape
restores the previous annotation. Clicking elsewhere commits. A complete edit is
one undo operation. Empty new text areas are discarded. Fonts and layout settings
are retained in annotation data and rendered in image/PDF exports.

```ts
const viewer = await mountMediaViewer(container, {
  source,
  profile: {
    textFonts: ['Helvetica', 'Times New Roman', 'Courier New'],
  },
  toolbar: {
    tools: ['text', 'callout'],
    properties: ['color', 'fill', 'fontFamily', 'fontSize', 'bold',
      'italic', 'underline', 'align', 'verticalAlign', 'strokeColor', 'stroke'],
  },
})
```

`textFonts` limits available family names. Self-host any custom font through a
stylesheet supplied to `styleSheets`; a family name alone does not download a
font. The viewer uses the browser font resolver for on-page text and raster
export. Source PDF content editing is a separate operation and preserves source
PDF fonts where the engine supports them.

English and Polish use separate locale modules. Custom dictionaries can be
supplied per locale as an object or async loader. `labels` takes precedence
over the active dictionary. The viewer links `heroui.css` and `viewer.css` inside its shadow root. It also loads
`properties.css` in the document for the framework’s CSS property registrations,
shared across viewers and removed when the last viewer closes. Serve all three
files next to the browser entry, or set `assetBaseUrl` to the directory that
serves them. Keep the `fonts/` directory beside those stylesheets. Signature fonts
are self-hosted WOFF2 files and load when the Type tab is opened; other viewers
do not request them. Pass `styleSheets` to append your own CSS URLs in cascade order.

### Notes and numbered pins

The notes group contains two tools: `note` and `pin`. Notes expose their color
palette and marker icons directly in the desktop properties toolbar. Pins
use a number and support an attached message. Both remain separate objects in
the annotation layer; changing their appearance never modifies the source image.

```ts
const viewer = await mountMediaViewer(container, {
  source: { kind: 'image', url: '/photos/inspection.jpg' },
  profile: {
    colors: ['#fff176', '#dc2626', '#2563eb'],
    noteIcons: ['comment', 'arrow', 'check', 'star'],
  },
  toolbar: {
    tools: ['note', 'pin'],
    properties: ['color', 'noteIcon'],
    noteColors: ['#fff176', '#dc2626'],
  },
  saveAnnotations: (annotations, signal) => saveInspection(annotations, signal),
})
```

Every `noteColors` value must also exist in `profile.colors`. An existing
annotation with another allowed color keeps that color available for editing.
Use the language dictionaries to replace labels and tooltips. The palette and
icon strip support keyboard selection through HeroUI radio groups.

At compact widths, the secondary toolbar shows property icons. Selecting one
expands its control inside the same row, with a back arrow. The annotations
preset keeps the main tool groups horizontally scrollable, including their
individual dropdowns. Showing, hiding, or expanding properties overlays the
document rather than resizing its viewport.

### PDF page display and text selection

Set `scrollMode: 'continuous'` to read pages vertically, or `'paginated'` to show
one page at a time (the default). The Page display toolbar menu switches between
them. Omit `viewMode` from `toolbar.items` to hide that menu while keeping your
configured mode.

```ts
const viewer = await mountMediaViewer(container, {
  source: {
    kind: 'pdf',
    source: '/documents/brochure.pdf',
    pdf: { workerUrl: '/viewer/pdfium-worker.js', wasmUrl: '/viewer/pdfium.wasm' },
  },
  scrollMode: 'continuous',
  saveAnnotations: (annotations, signal) => saveReview(annotations, signal),
})

await viewer.setScrollMode('paginated')
viewer.setPage(2) // Zero-based: page 3, in either mode.

// A magazine: cover alone, followed by facing pages (2–3, 4–5, …).
await viewer.setScrollMode('continuous')
await viewer.setPageLayout('double', true)
// Turn the cover exception off, or restore one page per row:
await viewer.setPageLayout('double', false)
await viewer.setPageLayout('single')
```

Set `pageLayout: 'double'` and `firstPageSingle: true` when mounting to start
with a book layout. Page layout and scroll mode are independent: facing pages
also work in paginated mode. Previous/Next and Page Up/Page Down turn complete
spreads; entering a page number, search, links, and bookmarks target the exact
page. Annotations keep their original page identity when display layout changes.
The Page display menu exposes both layouts and the separate-cover setting.
At compact widths, the pager becomes a simple current/total indicator. Search
always shows the current match and total count, including `0 of 0` before a match.

Thumbnail dimensions follow actual rotated PDF page sizes. Numbers sit below
the image, outside its surface. Drag the sidebar divider to change its width;
columns adjust to the available space. Only nearby thumbnail cells are mounted,
and only visible images enter the rendering queue. Thumbnail display size is
independent of its bounded raster resolution, so resizing retains loaded pixels.
The document scales live during a sidebar drag and retains its preview while the
final detailed render is prepared. Geometry is cached until a resize or document
change, so scrolling does not remeasure every PDF page.

Continuous mode keeps a bounded window of page surfaces near the viewport.
Page dimensions are read in one worker operation before layout, without rasterizing
every page. Visible pages render first; page previews and detailed tiles share the PDFium
worker. Tile raster caching is bounded to 24 MiB across the page window.
Scrolling away releases page canvases and text layers. This controls decoded
page resources; it does not turn source download into incremental PDF loading.

In Select mode, drag over actual PDF text to open the inline toolbar: highlight,
strikethrough, underline, squiggly underline, comment, or mark for redaction.
`profile.textMarkupActions` limits these actions. Native selection supplies copy
semantics; merged line geometry supplies a continuous selection background.
Read mode permits selecting/copying text but hides annotation actions. Image-only
PDF pages need OCR before their text can be selected; OCR is not included.
Pending redaction marks are review annotations. Apply them before exporting a
redacted revision. Applying marks removes affected content in the target areas,
then renders the selected fill and optional overlay label. This operation
addresses page content. Metadata, attachments and other document-level data
require their own sanitization policy. Saved annotations remain associated with
their page in both display modes.

The default zoom mode is `fit-page`, which uses the smaller of the horizontal
and vertical viewport-fitting scales. A portrait cover is fully visible at
opening. The SDK also exposes width fitting and bounded numeric scale:

```ts
await viewer.fitPage()
await viewer.fitWidth()
await viewer.setZoom(1.25) // 125%, expressed as a scale rather than a percentage.
const { zoomMode, zoomLevel, scrollMode, pageIndex } = viewer.getState()
```

Configure the initial scale with `zoom: { level: 1.25, min: 0.1, max: 8 }`, or
choose `zoom: { mode: 'fit-width' }`. The fit button switches between Fit page
and Fit width in one click, updating its icon and tooltip to the next action.
Hide it by omitting `zoomMode` from `toolbar.items`; numeric zoom remains available
through `setZoom()`. Pan drags the viewport without selecting or editing annotations.
A change to the page number commits on Enter or when the field is left.
Scrolling the document updates the displayed page without focusing the field;
an unfinished page-number draft is discarded when the user scrolls the document.


### Printing

The Print action prepares every page, including its annotation layer, while a
HeroUI progress modal shows the completed page count. Cancel stops preparation.
Only after all page images have decoded does the native browser print dialog open.
The printable document contains the page images only: no viewer toolbar, browser
URL, date or page counters. Proportions are preserved and pages fit the selected
paper. A uniformly landscape document requests landscape paper; mixed orientations
use the printer's paper settings. Browser and printer settings still control the
physical sheet and printable area.

```ts
const viewer = await openMediaViewerModal({
  source,
  printOptions: {
    dpi: 144,
    maxPagePixels: 4_194_304,
    maxTotalPixels: 67_108_864,
    maxBytes: 134_217_728,
  },
})
await viewer.print()
```

Serve `print.css` alongside `viewer.css` and `heroui.css` in the browser asset
directory. It loads only when printing begins. DPI is a target; the total and
per-page memory budgets can lower the raster scale. Documents exceeding the
configured minimum quality or encoded-byte limit stop with an error instead of
printing incomplete pages. Preparation renders one page at a time and releases
its working canvas after encoding. After the native dialog closes, the print
DOM, stylesheet and temporary image URLs are removed. Only one print job per
browser document can run at once. Hiding `print` in `toolbar.items` also disables
the viewer's print API and shortcut.

### Inserting images and links

Image and Link open HeroUI modals with HeroUI controls and buttons. Image accepts
PNG, JPEG and WebP files up to 5 MB, previews the chosen image and stores an
optimized image in the annotation layer. Link accepts HTTP/HTTPS websites and,
for PDF, a page number within the current document. Invalid values keep the modal
open with a translated message. Close, Cancel and Escape leave the document
unchanged. The menus and modals work inside the SDK's fullscreen view as well as
an embedded viewer.


## Develop locally

```sh
npm ci
npx playwright install chromium
npm run verify
npm run test:distribution
npm run examples:fetch
npm run demo
```

The standalone example runs at `http://127.0.0.1:4178`. Optional brochure examples
are cached locally by `examples:fetch`; these third-party documents are excluded
from the package. `test:brochures` exercises the cached examples separately.
`npm pack --dry-run` lists the public distribution. Publication is an explicit
maintainer operation, never part of the build or verification scripts.


## Community

Questions and integration ideas belong in [Discussions](https://github.com/janczakb/flex-canvas/discussions).
Report reproducible bugs through [Issues](https://github.com/janczakb/flex-canvas/issues).
See [Contributing](./CONTRIBUTING.md), the [Code of Conduct](./CODE_OF_CONDUCT.md)
and the [Security Policy](./SECURITY.md) before submitting changes or reports.
