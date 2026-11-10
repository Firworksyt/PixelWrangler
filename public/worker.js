// Decodes the image and runs the pipeline off the main thread.
//
// Messages in:
//   { type: "load", file }                              decode a File/Blob
//   { type: "render", job, key, w, h, pos, palettes: [{slug, colors}] }
// Messages out:
//   { type: "loaded", width, height } | { type: "load-error", message }
//   { type: "result", key, slug, w, h, rgb }            one per palette

import { floydSteinberg, hexPalette, toSmall } from "./lib/pipeline.js";

let image = null; // { rgba, width, height }
let small = null; // { key, rgb }
let latestJob = 0;
let queue = Promise.resolve();

self.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "load") {
        latestJob = Infinity; // drop any render still running for the old image
        queue = queue.then(() => load(msg.file));
    } else if (msg.type === "render") {
        latestJob = msg.job;
        queue = queue.then(() => render(msg));
    }
};

async function load(file) {
    image = null;
    small = null;
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const { width, height } = bitmap;
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        image = { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
        self.postMessage({ type: "loaded", width, height });
    } catch (err) {
        self.postMessage({ type: "load-error", message: String(err?.message || err) });
    }
}

// Yield so newer messages can arrive and supersede this job.
const tick = () => new Promise((r) => setTimeout(r, 0));

async function render({ job, key, w, h, pos, palettes }) {
    if (!image) return;
    await tick();
    if (job !== latestJob) return;

    if (small?.key !== key) {
        small = { key, rgb: toSmall(image.rgba, image.width, image.height, w, h, pos) };
    }

    for (const p of palettes) {
        await tick();
        if (job !== latestJob) return;
        const rgb = floydSteinberg(small.rgb, w, h, hexPalette(p.colors));
        self.postMessage({ type: "result", key, slug: p.slug, w, h, rgb }, [rgb.buffer]);
    }
}
