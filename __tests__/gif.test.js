// The GIF encoder is checked by decoding its output with an independent decoder.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import omggif from "omggif";
import { PNG } from "pngjs";
import { delayFor, encodeGif } from "../public/lib/gif.js";
import { floydSteinbergIndices, hexPalette, toSmall } from "../public/lib/pipeline.js";

const { GifReader } = omggif;
const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function concat(chunks) {
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) {
        out.set(c, o);
        o += c.length;
    }
    return out;
}

function randomFrames(count, w, h, colors, seed = 1) {
    let s = seed;
    const rand = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
    return Array.from({ length: count }, () => Uint8Array.from({ length: w * h }, () => Math.floor(rand() * colors)));
}

function randomPalette(colors) {
    return Uint8Array.from({ length: colors * 3 }, (_, i) => (i * 97 + 13) % 256);
}

/** Decode every frame and check each output pixel is the palette colour of its source index. */
function expectRoundTrip({ frames, w, h, palette, scale = 1, delay = 25 }) {
    const gif = new GifReader(concat(encodeGif({ width: w, height: h, palette, frames, scale, delay })));
    expect(gif.width).toBe(w * scale);
    expect(gif.height).toBe(h * scale);
    expect(gif.numFrames()).toBe(frames.length);
    const rgba = new Uint8Array(gif.width * gif.height * 4);
    frames.forEach((frame, f) => {
        expect(gif.frameInfo(f).delay).toBe(delay);
        gif.decodeAndBlitFrameRGBA(f, rgba);
        for (let y = 0; y < gif.height; y++) {
            for (let x = 0; x < gif.width; x++) {
                const idx = frame[((y / scale) | 0) * w + ((x / scale) | 0)];
                const o = (y * gif.width + x) * 4;
                if (rgba[o] !== palette[idx * 3] || rgba[o + 1] !== palette[idx * 3 + 1] ||
                    rgba[o + 2] !== palette[idx * 3 + 2]) {
                    throw new Error(`frame ${f} pixel (${x}, ${y}) doesn't match`);
                }
            }
        }
    });
    return gif;
}

describe("encodeGif", () => {
    test("round-trips several frames exactly and loops forever", () => {
        const gif = expectRoundTrip({ frames: randomFrames(3, 40, 30, 8), w: 40, h: 30, palette: randomPalette(8) });
        expect(gif.loopCount()).toBe(0);
    });

    test("upscales each pixel to scale x scale", () => {
        expectRoundTrip({ frames: randomFrames(2, 13, 7, 16, 2), w: 13, h: 7, palette: randomPalette(16), scale: 3 });
    });

    test("survives LZW table resets (256 colours, noisy frame)", () => {
        expectRoundTrip({ frames: randomFrames(1, 300, 200, 256, 3), w: 300, h: 200, palette: randomPalette(256) });
    });

    test.each([1, 2, 3, 5, 17, 129])("handles a %i-colour palette", (colors) => {
        expectRoundTrip({ frames: randomFrames(2, 31, 9, colors, colors), w: 31, h: 9, palette: randomPalette(colors) });
    });

    test("keeps the requested delay", () => {
        expectRoundTrip({ frames: randomFrames(2, 4, 4, 4), w: 4, h: 4, palette: randomPalette(4), delay: 33 });
    });

    test("a single frame has no loop extension", () => {
        const gif = expectRoundTrip({ frames: randomFrames(1, 8, 8, 4), w: 8, h: 8, palette: randomPalette(4) });
        expect(gif.loopCount()).toBe(null);
    });

    test("a dithered photo survives at full 8x size", () => {
        const png = PNG.sync.read(readFileSync(join(FIX, "input", "landscape.png")));
        const small = toSmall(png.data, png.width, png.height, 256, 128);
        const palette = hexPalette(["0d2b45", "203c56", "544e68", "8d697a", "d08159", "ffaa5e", "ffd4a3", "ffecd6"]);
        const frame = floydSteinbergIndices(small, 256, 128, palette);
        expectRoundTrip({ frames: [frame, frame], w: 256, h: 128, palette, scale: 8 });
    });

    test("reports progress per frame", () => {
        const calls = [];
        encodeGif({
            width: 2, height: 2, palette: randomPalette(2), frames: randomFrames(3, 2, 2, 2),
            onProgress: (done, total) => calls.push(`${done}/${total}`),
        });
        expect(calls).toEqual(["1/3", "2/3", "3/3"]);
    });
});

describe("delayFor", () => {
    test.each([[4, 25], [2, 50], [3, 33], [10, 10], [0.5, 200], [100, 2]])("%s fps -> %s", (fps, cs) => {
        expect(delayFor(fps)).toBe(cs);
    });
});
