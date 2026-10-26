# HAR Analyzer

A local-only HAR file analyzer packaged as a desktop app for Windows.

This project lets you open `.har` files, inspect requests and responses, filter traffic, compare two captures, and review performance details without sending data anywhere.

## Features

- Open HAR files from disk
- Local-only processing in the browser/Electron app
- Filter requests by method, status, type, domain, MIME, duration, size, and cache state
- Search by URL, headers, or response content
- Inspect request/response headers, query strings, cookies, timings, flow data, and raw payloads
- Compare a baseline HAR against a comparison HAR
- Redact sensitive values in headers and query parameters
- Package as a Windows desktop EXE for easy local use

## Project structure

- `index.html` — app shell
- `styles.css` — UI styling and layout
- `main.js` — Electron desktop app entry point
- `js/` — parsing, filtering, analysis, formatting, and security logic
- `dist/har-analyzer 1.0.0.exe` — packaged Windows desktop app

## Run from source

Requirements:

- Node.js 18+ recommended
- npm

From the project root:

```bash
npm install
npm start
```

This will launch the Electron desktop app.

## Run the packaged Windows app

Double-click:

```text
dist\har-analyzer 1.0.0.exe
```

## Notes

- All HAR parsing and analysis is done locally in the app.
- The app does not upload files to a server.
- The comparison mode is intended for a baseline HAR and a newer comparison HAR to quantify changes in request count, transferred bytes, duration, and errors.

## License

This project is provided as-is for local desktop use.
