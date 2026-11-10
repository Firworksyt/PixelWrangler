// The image pipeline, ported from the original Python prototype:
//   1. crop to the chosen aspect ratio and Lanczos-downscale to ~32k pixels
//   2. map to a palette with Floyd–Steinberg error diffusion
//   3. nearest-neighbour upscale x8 for download
// Every step reproduces the prototype's output exactly (see __tests__/parity.test.js).

import { resizeLanczos } from "./resample.js";

export const UPSCALE = 8;

// [w, h] of the small image for each ratio, landscape. Each keeps the 256x128
// pixel budget (~32768 px) so the pixels stay the same size across ratios.
export const RATIOS = {
    "2:1": [256, 128],
    "16:9": [240, 135],
    "3:2": [222, 148],
    "4:3": [208, 156],
    "1:1": [181, 181],
};

export function targetSize(ratio, portrait = false) {
    const [w, h] = RATIOS[ratio];
    return portrait ? { w: h, h: w } : { w, h };
}

/**
 * The largest region of a srcW x srcH image with the aspect of tw:th.
 * pos (0..1) slides it along the axis that has room; 0.5 is centred and
 * matches the prototype's crop exactly.
 */
export function cropBox(srcW, srcH, tw, th, pos = 0.5) {
    const target = tw / th;
    if (srcW / srcH > target) {
        const nw = Math.max(1, Math.trunc(srcH * target));
        return { x: Math.floor((srcW - nw) * pos), y: 0, w: nw, h: srcH, axis: "x" };
    }
    const nh = Math.max(1, Math.trunc(srcW / target));
    return { x: 0, y: Math.floor((srcH - nh) * pos), w: srcW, h: nh, axis: "y" };
}

/** Steps 1: crop + Lanczos downscale. Returns tw*th*3 RGB. */
export function toSmall(rgba, srcW, srcH, tw, th, pos = 0.5, channels = 4) {
    return resizeLanczos(rgba, srcW, channels, cropBox(srcW, srcH, tw, th, pos), tw, th);
}

/** ["0d2b45", ...] -> Int32Array [r,g,b, r,g,b, ...] */
export function hexPalette(hexes) {
    const pal = new Int32Array(hexes.length * 3);
    hexes.forEach((h, i) => {
        for (let c = 0; c < 3; c++) pal[i * 3 + c] = parseInt(h.slice(c * 2, c * 2 + 2), 16);
    });
    return pal;
}

/**
 * Step 2: Floyd–Steinberg at strength 1.0, exactly as quantize_fs().
 * Quirks kept on purpose: the working buffer is clamped to 0..255 after every
 * error push, and the nearest-colour search truncates the working values to ints.
 */
export function floydSteinberg(rgb, w, h, pal) {
    const work = Float64Array.from(rgb);
    const out = new Uint8Array(w * h * 3);
    const n = pal.length / 3;
    const push = (j, er, eg, eb, f) => {
        work[j] = clamp(work[j] + (er * f) / 16);
        work[j + 1] = clamp(work[j + 1] + (eg * f) / 16);
        work[j + 2] = clamp(work[j + 2] + (eb * f) / 16);
    };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 3;
            const r = work[i], g = work[i + 1], b = work[i + 2];
            const ri = Math.trunc(r), gi = Math.trunc(g), bi = Math.trunc(b);
            let best = 0;
            let bestD = Infinity;
            for (let p = 0; p < n; p++) {
                const dr = ri - pal[p * 3], dg = gi - pal[p * 3 + 1], db = bi - pal[p * 3 + 2];
                const d = dr * dr + dg * dg + db * db;
                if (d < bestD) { bestD = d; best = p; }
            }
            const nr = pal[best * 3], ng = pal[best * 3 + 1], nb = pal[best * 3 + 2];
            out[i] = nr; out[i + 1] = ng; out[i + 2] = nb;
            const er = r - nr, eg = g - ng, eb = b - nb;
            if (x + 1 < w) push(i + 3, er, eg, eb, 7);
            if (y + 1 < h) {
                const below = i + w * 3;
                if (x > 0) push(below - 3, er, eg, eb, 3);
                push(below, er, eg, eb, 5);
                if (x + 1 < w) push(below + 3, er, eg, eb, 1);
            }
        }
    }
    return out;
}

function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Step 3: RGB -> RGBA, each pixel repeated scale x scale. */
export function upscaleRGBA(rgb, w, h, scale = UPSCALE) {
    const W = w * scale;
    const out = new Uint8ClampedArray(W * h * scale * 4);
    for (let y = 0; y < h; y++) {
        const row = new Uint8ClampedArray(W * 4);
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 3;
            for (let s = 0; s < scale; s++) {
                const o = (x * scale + s) * 4;
                row[o] = rgb[i]; row[o + 1] = rgb[i + 1]; row[o + 2] = rgb[i + 2]; row[o + 3] = 255;
            }
        }
        for (let s = 0; s < scale; s++) out.set(row, (y * scale + s) * W * 4);
    }
    return out;
}

/** RGB -> RGBA (alpha 255), for putting the small image on a canvas. */
export function rgbToRGBA(rgb) {
    const out = new Uint8ClampedArray((rgb.length / 3) * 4);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        out[j] = rgb[i]; out[j + 1] = rgb[i + 1]; out[j + 2] = rgb[i + 2]; out[j + 3] = 255;
    }
    return out;
}
