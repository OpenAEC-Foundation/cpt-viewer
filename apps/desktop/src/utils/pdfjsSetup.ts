/**
 * One-stop pdfjs-dist init.
 *
 * PDF.js refuses to do anything until `GlobalWorkerOptions.workerSrc`
 * points at a same-origin worker bundle, so we wire that up once here
 * and re-export the named API surface we actually use from the rest of
 * the app (just `getDocument` for now). Vite's `?url` suffix gives us
 * a hashed asset URL that survives `vite build` and works under the
 * Tauri `tauri://localhost` scheme.
 */
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

export { getDocument };
