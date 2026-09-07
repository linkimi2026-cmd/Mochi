# Mochi Office engine POC

This is a bounded integration base for the official ONLYOFFICE DocumentServer Community image. It is not a WPS clone and is not enabled in Mochi UI or production profile.

The pinned official image `onlyoffice/documentserver:9.4.0.1` publishes a native `linux/arm64` variant. The compose file binds only `127.0.0.1:18080`, enables JWT, requires the secret from the process environment, and limits the container to four CPUs and 5 GiB. Use the isolated `mochi-office` Colima profile; do not place secrets in this directory.

`OfficeVersionStore` accepts only host-configured IDs mapped to regular `.docx`, `.xlsx`, or `.pptx` files under one allowed root. A valid HS256 ONLYOFFICE callback may download only from configured DocumentServer origins, with redirects rejected, a 15-second timeout, and a 50 MiB limit. Status 2/6 saves a new numbered copy. Duplicate callback bodies acknowledge without another version; status such as editing/closed-without-save acknowledges without writing. Existing source and versions are never overwritten.

The Community code/image is AGPLv3 and suitable for a small self-hosted evaluation. Its licensing and connection limits must be reviewed before any school-wide deployment. The visible editor must retain ONLYOFFICE branding and applicable license notices.

Current local probe: the isolated ARM64 Colima VM starts with 4 CPU and 6 GiB, but Docker Registry timed out before returning the image manifest, so no editor/callback browser loop has yet been claimed as verified.

## Local adapter

Set a secret of at least 24 characters and run `node run-demo.mjs`; the service binds only `127.0.0.1:18100`. `MOCHI_OFFICE_PUBLIC_BASE_URL` may override the URL that DocumentServer uses to fetch the document and post callbacks. The demo launcher exposes only artifact ID `teacher-document-demo`. A loopback listener is not automatically reachable from the Colima container: until that bridge has been independently proved and `MOCHI_OFFICE_BRIDGE_VERIFIED=true` is set, health reports `callbackReachable: false` and editor configuration fails closed with HTTP 503.

- `GET /health` reports the actual DocumentServer health and demo IDs.
- `GET /api/office/documents/:id/editor-config` returns the official Docs API script URL and signed editor configuration, or HTTP 503 while the engine is offline.
- `GET /api/office/documents/:id/content?token=...` serves an allowlisted current version through a five-minute read token.
- `POST /api/office/documents/:id/callback` accepts a fully signed callback whose document key matches the route.
- `GET /api/office/documents/:id/versions` lists saved version numbers and names without filesystem paths.

Browser CORS is limited to Mochi on `localhost` or `127.0.0.1` ports `3090` and `3094` (the isolated workbench acceptance port). The adapter does not attempt to inspect a cross-origin editor iframe.
