// Port of Pillow's Lanczos resize (libImaging/Resample.c, 8 bits per channel),
// so the downscale matches Image.resize(..., Image.LANCZOS) byte for byte.
// Two passes, horizontal first, with the same fixed-point weights and rounding.

const PRECISION_BITS = 32 - 8 - 2;
const LANCZOS_SUPPORT = 3.0;

function sinc(x) {
    if (x === 0.0) return 1.0;
    x = x * Math.PI;
    return Math.sin(x) / x;
}

function lanczos(x) {
    if (-3.0 <= x && x < 3.0) return sinc(x) * sinc(x / 3);
    return 0.0;
}

// precompute_coeffs + normalize_coeffs_8bpc
function precomputeCoeffs(inSize, in0, in1, outSize) {
    const scale = (in1 - in0) / outSize;
    const filterscale = scale < 1.0 ? 1.0 : scale;
    const support = LANCZOS_SUPPORT * filterscale;
    const ksize = Math.ceil(support) * 2 + 1;
    const pre = new Float64Array(outSize * ksize);
    const bounds = new Int32Array(outSize * 2);
    const ss = 1.0 / filterscale;
    for (let xx = 0; xx < outSize; xx++) {
        const center = in0 + (xx + 0.5) * scale;
        let xmin = Math.trunc(center - support + 0.5);
        if (xmin < 0) xmin = 0;
        let xmax = Math.trunc(center + support + 0.5);
        if (xmax > inSize) xmax = inSize;
        xmax -= xmin;
        const k = xx * ksize;
        let ww = 0.0;
        for (let x = 0; x < xmax; x++) {
            const w = lanczos((x + xmin - center + 0.5) * ss);
            pre[k + x] = w;
            ww += w;
        }
        for (let x = 0; x < xmax; x++) {
            if (ww !== 0.0) pre[k + x] /= ww;
        }
        bounds[xx * 2] = xmin;
        bounds[xx * 2 + 1] = xmax;
    }
    const kk = new Int32Array(outSize * ksize);
    const one = 1 << PRECISION_BITS;
    for (let i = 0; i < kk.length; i++) {
        kk[i] = pre[i] < 0 ? Math.trunc(-0.5 + pre[i] * one) : Math.trunc(0.5 + pre[i] * one);
    }
    return { ksize, bounds, kk };
}

function clip8(v) {
    v = v >> PRECISION_BITS;
    return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Lanczos-resize a region of an RGBA/RGB buffer into a new RGB buffer.
 * Equivalent to Pillow's `im.crop((cx, cy, cx+cw, cy+ch)).resize((outW, outH), LANCZOS)`.
 *
 * @param {Uint8Array|Uint8ClampedArray} src  pixel data, `channels` bytes per pixel
 * @param {number} srcW  source row width in pixels
 * @param {number} channels  3 (RGB) or 4 (RGBA, alpha ignored)
 * @param {{x:number,y:number,w:number,h:number}} crop  region to resize
 * @returns {Uint8Array} outW*outH*3 RGB
 */
export function resizeLanczos(src, srcW, channels, crop, outW, outH) {
    const { x: cx, y: cy, w: cw, h: ch } = crop;
    const needH = outW !== cw;
    const needV = outH !== ch;

    // Rows we read from, and how to fetch a source channel.
    let rows = ch;
    let rowOffset = 0;
    let vert = null;
    if (needV) {
        vert = precomputeCoeffs(ch, 0, ch, outH);
        const last = (outH - 1) * 2;
        rowOffset = vert.bounds[0];
        rows = vert.bounds[last] + vert.bounds[last + 1] - rowOffset;
    }

    // Pass 1: horizontal, over only the rows the vertical pass will use.
    let tmp;
    let tmpW;
    if (needH) {
        const { ksize, bounds, kk } = precomputeCoeffs(cw, 0, cw, outW);
        tmpW = outW;
        tmp = new Uint8Array(outW * rows * 3);
        const half = 1 << (PRECISION_BITS - 1);
        for (let yy = 0; yy < rows; yy++) {
            const rowBase = ((cy + rowOffset + yy) * srcW + cx) * channels;
            for (let xx = 0; xx < outW; xx++) {
                const xmin = bounds[xx * 2];
                const xmax = bounds[xx * 2 + 1];
                const k = xx * ksize;
                let s0 = half, s1 = half, s2 = half;
                for (let x = 0; x < xmax; x++) {
                    const p = rowBase + (x + xmin) * channels;
                    const w = kk[k + x];
                    s0 += src[p] * w;
                    s1 += src[p + 1] * w;
                    s2 += src[p + 2] * w;
                }
                const o = (yy * outW + xx) * 3;
                tmp[o] = clip8(s0);
                tmp[o + 1] = clip8(s1);
                tmp[o + 2] = clip8(s2);
            }
        }
    } else {
        tmpW = cw;
        tmp = new Uint8Array(cw * rows * 3);
        for (let yy = 0; yy < rows; yy++) {
            for (let x = 0; x < cw; x++) {
                const p = ((cy + rowOffset + yy) * srcW + cx + x) * channels;
                const o = (yy * cw + x) * 3;
                tmp[o] = src[p];
                tmp[o + 1] = src[p + 1];
                tmp[o + 2] = src[p + 2];
            }
        }
    }
    if (!needV) return tmp;

    // Pass 2: vertical.
    const { ksize, bounds, kk } = vert;
    const out = new Uint8Array(tmpW * outH * 3);
    const half = 1 << (PRECISION_BITS - 1);
    for (let yy = 0; yy < outH; yy++) {
        const ymin = bounds[yy * 2] - rowOffset;
        const ymax = bounds[yy * 2 + 1];
        const k = yy * ksize;
        for (let xx = 0; xx < tmpW; xx++) {
            let s0 = half, s1 = half, s2 = half;
            for (let y = 0; y < ymax; y++) {
                const p = ((y + ymin) * tmpW + xx) * 3;
                const w = kk[k + y];
                s0 += tmp[p] * w;
                s1 += tmp[p + 1] * w;
                s2 += tmp[p + 2] * w;
            }
            const o = (yy * tmpW + xx) * 3;
            out[o] = clip8(s0);
            out[o + 1] = clip8(s1);
            out[o + 2] = clip8(s2);
        }
    }
    return out;
}
