import { RATIOS, cropBox, floydSteinberg, hexPalette, targetSize, upscaleRGBA } from "../public/lib/pipeline.js";

describe("RATIOS", () => {
    test("every ratio keeps roughly the 256x128 pixel budget", () => {
        for (const [w, h] of Object.values(RATIOS)) {
            expect(Math.abs(w * h - 256 * 128) / (256 * 128)).toBeLessThan(0.015);
        }
    });

    test("portrait swaps the dimensions", () => {
        expect(targetSize("4:3", true)).toEqual({ w: 156, h: 208 });
    });
});

describe("cropBox", () => {
    test("centred crop of a wide image trims the sides", () => {
        expect(cropBox(1000, 300, 256, 128)).toEqual({ x: 200, y: 0, w: 600, h: 300, axis: "x" });
    });

    test("centred crop of a tall image trims top and bottom", () => {
        expect(cropBox(400, 600, 256, 128)).toEqual({ x: 0, y: 200, w: 400, h: 200, axis: "y" });
    });

    test("pos slides the box to either edge", () => {
        expect(cropBox(1000, 300, 256, 128, 0).x).toBe(0);
        expect(cropBox(1000, 300, 256, 128, 1).x).toBe(400);
    });

    test("never returns an empty box", () => {
        const b = cropBox(1, 1000, 256, 128);
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThan(0);
    });
});

describe("floydSteinberg", () => {
    test("output only contains palette colours", () => {
        const w = 32, h = 16;
        const rgb = new Uint8Array(w * h * 3).map((_, i) => (i * 37) % 256);
        const pal = hexPalette(["000000", "ff0000", "00ff00", "ffffff"]);
        const out = floydSteinberg(rgb, w, h, pal);
        const allowed = new Set(["0,0,0", "255,0,0", "0,255,0", "255,255,255"]);
        for (let i = 0; i < out.length; i += 3) {
            expect(allowed.has(`${out[i]},${out[i + 1]},${out[i + 2]}`)).toBe(true);
        }
    });
});

describe("upscaleRGBA", () => {
    test("repeats each pixel scale x scale with opaque alpha", () => {
        const out = upscaleRGBA(new Uint8Array([1, 2, 3, 4, 5, 6]), 2, 1, 2);
        expect(Array.from(out)).toEqual([
            1, 2, 3, 255, 1, 2, 3, 255, 4, 5, 6, 255, 4, 5, 6, 255,
            1, 2, 3, 255, 1, 2, 3, 255, 4, 5, 6, 255, 4, 5, 6, 255,
        ]);
    });
});
