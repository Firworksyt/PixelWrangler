// The pipeline must reproduce the original Python prototype's output byte for byte.
// The fixtures are that prototype's output, frozen; don't regenerate them casually.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { floydSteinberg, hexPalette, toSmall } from "../public/lib/pipeline.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const manifest = JSON.parse(readFileSync(join(FIX, "manifest.json"), "utf8"));

function readPng(path) {
    const png = PNG.sync.read(readFileSync(path));
    return { w: png.width, h: png.height, rgba: png.data };
}

function rgbOf({ rgba }) {
    const out = new Uint8Array((rgba.length / 4) * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2];
    }
    return out;
}

function firstDiff(a, b, w) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            const p = Math.floor(i / 3);
            return `first mismatch at (${p % w}, ${Math.floor(p / w)}) channel ${i % 3}: got ${a[i]}, want ${b[i]}`;
        }
    }
    return null;
}

describe("crop + Lanczos resize matches Pillow", () => {
    test.each(manifest.resize.map((c) => [c.expected, c]))("%s", (_name, c) => {
        const src = readPng(join(FIX, "input", c.input));
        const want = rgbOf(readPng(join(FIX, "expected", c.expected)));
        const got = toSmall(src.rgba, src.w, src.h, c.w, c.h, c.pos);
        expect(got.length).toBe(want.length);
        expect(firstDiff(got, want, c.w)).toBeNull();
    });
});

describe("Floyd–Steinberg matches quantize_fs", () => {
    test.each(manifest.fs.map((c) => [c.expected, c]))("%s", (_name, c) => {
        const src = readPng(join(FIX, "expected", c.source));
        const want = rgbOf(readPng(join(FIX, "expected", c.expected)));
        const got = floydSteinberg(rgbOf(src), src.w, src.h, hexPalette(manifest.palettes[c.palette]));
        expect(firstDiff(got, want, src.w)).toBeNull();
    });
});
