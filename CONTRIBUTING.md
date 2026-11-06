# Contributing to FLEX Canvas

Thanks for helping improve FLEX Canvas. Use [Discussions](https://github.com/janczakb/flex-canvas/discussions)
for usage questions, [Issues](https://github.com/janczakb/flex-canvas/issues) for
reproducible bugs and feature proposals, and pull requests for concrete changes.
For security concerns, follow [SECURITY.md](./SECURITY.md).

## Set up the standalone SDK

Use Node.js 24, the version tested in CI.

```sh
git clone https://github.com/janczakb/flex-canvas.git
cd flex-canvas
npm ci
npx playwright install chromium
npm run build
npm run demo
```

The example opens at `http://127.0.0.1:4178`. Its image sample is included. The two
optional hotel brochure examples require `npm run examples:fetch`; downloaded
brochures stay in `.cache/` and must not be committed. Automated regression tests
use owned fixtures and do not require those downloads.

## Make a focused change

- Describe the problem, expected behavior and a small reproduction first.
- Keep the SDK independent of Laravel, Filament and application-specific storage.
- Preserve the explicit save/replacement callbacks and separate annotation layer.
- Add or update meaningful regression tests for changed behavior.
- Update the public types and README when changing the API. Keep internal notes,
  recordings, credentials and generated `dist/` files out of the repository.
- Preserve third-party notices. Contributions must be your original work or code
  you have permission to contribute under compatible terms.

## Verify before opening a pull request

```sh
npm run verify
npm run test:distribution
npm pack --dry-run
```

`verify` builds the source and runs native PDF and browser regression tests.
`test:distribution` installs the actual tarball into a temporary consumer and
checks its types, styles, cross-origin PDF worker, images and global theme.
Additional browser checks can run with Firefox or WebKit after installing them:

```sh
npx playwright install firefox webkit
BROWSER=firefox node tests/media-viewer-pdf-layout.mjs
BROWSER=webkit node tests/media-viewer-resize-stability.mjs
```

Include the checks you ran and any remaining limitations in your pull request.
Avoid unrelated formatting changes, generated bundles and real customer documents.

## License and contributions

FLEX Canvas is source-available, not an unrestricted open-source project. Read
[LICENSE](./LICENSE), including Section 5 on contributions, before submitting code.
You retain ownership of your contribution and grant the rights stated there.
Contributing does not itself grant a paid commercial license.
