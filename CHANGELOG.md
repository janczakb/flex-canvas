# Changelog

## 0.2.1 — 2026-11-28

- Stabilized toolbar dropdown anchors during opening and closing animations.
- Kept dropdowns and property popovers inside their embedded viewer boundary.
- Fixed menu sizing and labels for entries without leading icons.
- Started PDF initialization in parallel with toolbar and stylesheet preparation.
- Added regression coverage for stable press bounds and monotonic dropdown dismissal.

## 0.2.0 — 2026-11-19

- Added a standalone PDF reader entry with its own stylesheet and host controls.
- Added bounded random-access PDF loading and progress reporting for document resources.
- Improved PDF render scheduling, page-handle reuse and cancellation during expensive rendering.
- Improved continuous page flow, spread thumbnails and viewport stability.
- Expanded browser coverage for the reader, streaming, host API and search panel.

## 0.1.1 — 2026-11-06

- Added a configurable PDF sidebar allowlist for thumbnails, outline, annotations,
  bookmarks and signatures. An empty list hides the control, and a single panel
  opens directly.
- Fixed selecting, moving and reopening annotations positioned above selectable
  PDF text, including selecting a text annotation anywhere inside its box.
- Made browser regression tests independent of downloaded brochure examples.

## 0.1.0 — 2026-11-06

Initial public release of FLEX Canvas as `@useflex/canvas`.

- Standalone image and PDF workspace, embedded or fullscreen, with TypeScript types
  and a browser entry usable through a script tag or ES modules.
- Separate annotation layers with drawing, shapes, text, callouts, notes, numbered
  pins, image/link insertion and drawn, uploaded or typed visual signatures.
- PDFium WebAssembly worker, text selection and markup, search, outlines,
  bookmarks, thumbnails, continuous scrolling and single/double page layouts.
- PDF page organization, cropping, supported text-object editing and redactions
  applied to a working document revision, with explicit persistence callbacks.
- Configurable tools, translations and a global light/dark/automatic theme.
- Separate CSS and bundled font assets, with lazy PDF engine loading and
  cross-origin CDN worker support.
- Source-available license with permitted free use; paid FLEX Fields licenses
  include FLEX Canvas within their existing scope.
