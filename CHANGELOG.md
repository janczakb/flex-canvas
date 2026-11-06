# Changelog

## Unreleased

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
