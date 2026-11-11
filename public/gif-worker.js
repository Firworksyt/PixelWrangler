// Encodes one GIF off the main thread.
// In:  { width, height, palette, frames, scale, delay }
// Out: { type: "progress", done, total } ... then { type: "done", blob }

import { encodeGif } from "./lib/gif.js";

self.onmessage = (e) => {
    const chunks = encodeGif({
        ...e.data,
        onProgress: (done, total) => self.postMessage({ type: "progress", done, total }),
    });
    self.postMessage({ type: "done", blob: new Blob(chunks, { type: "image/gif" }) });
};
