# OCR (src/features/ocr)

`recognize(source, {lang, provider, onProgress, signal})` -> `{text, words, confidence}`. `ocrNote(note)` renders each page and returns `{pageId: text}`; `indexNoteOcr(noteId)` stores it in `note.ocr` and appends it to `textIndex` so search finds it.

Providers (`registerOcrProvider`, `listOcrProviders`, `setDefaultProvider`): `tesseract` (default), `remote` (POSTs the image to `setRemoteOcrConfig({url})`), `none`. A provider is `{name, init, recognize, terminate}`.

Tesseract: tesseract.js loads lazily on first use. Its worker and wasm core are emitted by Vite, so no CDN is needed. Language data downloads once from `setOcrConfig({langPath})` and tesseract.js caches it in IndexedDB. Jobs run one at a time, and the worker is terminated after 60 s idle. Inputs are greyscaled, contrast-stretched, upscaled and binarized first.

Honest limits: Tesseract works well on printed text and PDF scans but is weak on cursive handwriting. For handwriting, register a stronger provider (for example a remote service).
Respects `isEnabled('ocr')` from `core/modules.js` when present. SW should precache the emitted worker and core assets if OCR must work offline before first use.
