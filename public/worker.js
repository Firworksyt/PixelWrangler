// Decodes images and runs the pipeline off the main thread.
//
// Messages in:
//   { type: "load", file }                                 decode an image File/Blob
//   { type: "render", job, key, w, h, pos, palettes }       dither the image
//   { type: "video-start", job, key, count, w, h, pos }    begin a set of video frames
//   { type: "video-frame", job, index, bitmap }            one frame (ImageBitmap)
//   { type: "render-video", job, key, palettes }           dither every frame
//   palettes: [{ slug, colors }]
// Messages out:
//   { type: "loaded", width, height } | { type: "load-error", message }
//   { type: "frame-done", job, index }                     a video frame was resized
//   { type: "result", key, slug, w, h, frames }            one per palette; frames = [indices]

import { floydSteinbergIndices, hexPalette, toSmall } from "./lib/pipeline.js";

let image = null; // { rgba, width, height }
let small = null; // { key, rgb } for the image
let video = null; // { key, w, h, pos, frames: [rgb] }
let latestJob = 0;
let queue = Promise.resolve();

self.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "load") {
        latestJob = Infinity; // drop any render still running for the old image
        queue = queue.then(() => load(msg.file));
    } else if (msg.type === "render" || msg.type === "video-start" || msg.type === "render-video") {
        latestJob = msg.job;
        queue = queue.then(() => handlers[msg.type](msg));
    } else if (msg.type === "video-frame") {
        queue = queue.then(() => videoFrame(msg));
    }
};

const handlers = { render, "video-start": videoStart, "render-video": renderVideo };

async function load(file) {
    image = null;
    small = null;
    video = null;
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        image = { ...readBitmap(bitmap), width: bitmap.width, height: bitmap.height };
        bitmap.close();
        self.postMessage({ type: "loaded", width: image.width, height: image.height });
    } catch (err) {
        self.postMessage({ type: "load-error", message: String(err?.message || err) });
    }
}

function readBitmap(bitmap) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return { rgba: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
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
        const idx = floydSteinbergIndices(small.rgb, w, h, hexPalette(p.colors));
        self.postMessage({ type: "result", key, slug: p.slug, w, h, frames: [idx] }, [idx.buffer]);
    }
}

// ---------- video ----------

function videoStart({ job, key, count, w, h, pos }) {
    image = null;
    small = null;
    video = { job, key, w, h, pos, frames: new Array(count) };
}

function videoFrame({ job, index, bitmap }) {
    // Always acknowledge, so the sender's flow control never stalls.
    if (video?.job === job) {
        const { rgba } = readBitmap(bitmap);
        video.frames[index] = toSmall(rgba, bitmap.width, bitmap.height, video.w, video.h, video.pos);
    }
    bitmap.close();
    self.postMessage({ type: "frame-done", job, index });
}

async function renderVideo({ job, key, palettes }) {
    if (video?.key !== key) return;
    const { w, h, frames } = video;
    for (const p of palettes) {
        const pal = hexPalette(p.colors);
        const out = [];
        for (let i = 0; i < frames.length; i++) {
            if (i % 8 === 0) {
                await tick();
                if (job !== latestJob) return;
            }
            out.push(floydSteinbergIndices(frames[i], w, h, pal));
        }
        self.postMessage({ type: "result", key, slug: p.slug, w, h, frames: out }, out.map((f) => f.buffer));
    }
}
