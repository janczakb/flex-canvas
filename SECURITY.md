# Security policy

## Report a vulnerability privately

Open a [private security advisory](https://github.com/janczakb/flex-canvas/security/advisories/new)
or email **barek122@gmail.com** with the subject **FLEX Canvas security report**.
Please do not open a public issue containing an exploitable vulnerability or
private document data.

Include the affected `@useflex/canvas` version, browser/runtime, a minimal
reproduction using a document you may share, expected impact and any relevant
configuration. Remove API keys, authentication tokens and customer information.

Reports are reviewed privately. When a fix is available, remediation guidance
and an appropriate release note can be coordinated before public disclosure.

## Updates and integration boundaries

Security fixes are delivered through new npm versions. Check the latest release
and changelog when evaluating a report, and identify the precise version you use.
For self-hosted deployments, update the matching JavaScript, CSS, worker,
WebAssembly and font assets together.

The SDK renders and edits documents in the browser. Application servers remain
responsible for authentication, document authorization, input validation, storage,
concurrency checks and limits. Showing or hiding toolbar controls does not replace
server-side access rules. Applying redactions changes the working PDF revision;
applications must persist the accepted output rather than only its visual preview.

For usage questions or ordinary bugs, use the repository's Discussions or Issues.
