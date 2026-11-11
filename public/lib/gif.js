// Minimal animated GIF encoder for palette-indexed frames.
// Every frame shares one global colour table (the palette), so colours are exact.
// Frames are upscaled on the fly while encoding, so the full-size pixels are
// never held in memory.

const MAX_CODE = 4096; // GIF LZW codes are at most 12 bits

/** Frame delay in hundredths of a second (GIF's unit) for a frame rate. */
export function delayFor(fps) {
    return Math.max(2, Math.round(100 / fps));
}

/** Bits needed for a colour table holding n colours (GIF tables are 2..256 entries). */
function tableBits(n) {
    let bits = 1;
    while ((1 << bits) < n) bits++;
    return bits;
}

class Bytes {
    constructor(size = 1 << 16) {
        this.buf = new Uint8Array(size);
        this.len = 0;
    }
    ensure(extra) {
        if (this.len + extra <= this.buf.length) return;
        let size = this.buf.length * 2;
        while (size < this.len + extra) size *= 2;
        const next = new Uint8Array(size);
        next.set(this.buf.subarray(0, this.len));
        this.buf = next;
    }
    byte(b) {
        this.ensure(1);
        this.buf[this.len++] = b;
    }
    word(v) {
        this.byte(v & 0xff);
        this.byte((v >> 8) & 0xff);
    }
    bytes(arr) {
        this.ensure(arr.length);
        this.buf.set(arr, this.len);
        this.len += arr.length;
    }
    ascii(s) {
        for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
    }
    take() {
        return this.buf.slice(0, this.len);
    }
}

/**
 * LZW-compress one frame and write it as GIF data sub-blocks.
 * Follows the classic GIF encoder's code-size and table-reset rules.
 */
function writeImageData(out, frame, w, h, scale, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let maxCode = (1 << codeSize) - 1;
    let next = eoiCode + 1;
    let clearFlag = false;
    const dict = new Map();

    // Packed LZW bytes, flushed as 255-byte sub-blocks.
    const block = new Uint8Array(255);
    let blockLen = 0;
    let acc = 0;
    let accBits = 0;
    const flushBlock = () => {
        if (!blockLen) return;
        out.byte(blockLen);
        out.bytes(block.subarray(0, blockLen));
        blockLen = 0;
    };
    const emit = (code) => {
        acc |= code << accBits;
        accBits += codeSize;
        while (accBits >= 8) {
            block[blockLen++] = acc & 0xff;
            if (blockLen === 255) flushBlock();
            acc >>>= 8;
            accBits -= 8;
        }
        if (next > maxCode || clearFlag) {
            if (clearFlag) {
                codeSize = minCodeSize + 1;
                clearFlag = false;
            } else {
                codeSize++;
            }
            maxCode = codeSize === 12 ? MAX_CODE : (1 << codeSize) - 1;
        }
    };

    out.byte(minCodeSize);
    emit(clearCode);

    const W = w * scale;
    const H = h * scale;
    const srcX = new Int32Array(W);
    for (let x = 0; x < W; x++) srcX[x] = (x / scale) | 0;

    let prefix = -1;
    for (let y = 0; y < H; y++) {
        const row = ((y / scale) | 0) * w;
        for (let x = 0; x < W; x++) {
            const k = frame[row + srcX[x]];
            if (prefix < 0) {
                prefix = k;
                continue;
            }
            const key = (prefix << 8) | k;
            const code = dict.get(key);
            if (code !== undefined) {
                prefix = code;
                continue;
            }
            emit(prefix);
            prefix = k;
            if (next < MAX_CODE) {
                dict.set(key, next++);
            } else {
                dict.clear();
                next = eoiCode + 1;
                clearFlag = true;
                emit(clearCode);
            }
        }
    }
    emit(prefix);
    emit(eoiCode);
    if (accBits > 0) {
        block[blockLen++] = acc & 0xff;
        if (blockLen === 255) flushBlock();
    }
    flushBlock();
    out.byte(0); // block terminator
}

/**
 * Encode palette-indexed frames as a GIF that loops forever.
 *
 * @param {object} o
 * @param {number} o.width   frame width in source pixels
 * @param {number} o.height  frame height in source pixels
 * @param {ArrayLike<number>} o.palette  [r,g,b, r,g,b, ...]
 * @param {Uint8Array[]} o.frames  palette indices, width*height each
 * @param {number} [o.scale=1]  each pixel becomes scale x scale
 * @param {number} [o.delay=25]  frame delay in hundredths of a second
 * @param {(done:number,total:number)=>void} [o.onProgress]
 * @returns {Uint8Array[]} file chunks (concatenate, or pass to new Blob())
 */
export function encodeGif({ width, height, palette, frames, scale = 1, delay = 25, onProgress }) {
    const colors = palette.length / 3;
    const bits = tableBits(colors);
    const W = width * scale;
    const H = height * scale;
    if (W > 0xffff || H > 0xffff) throw new Error("GIF dimensions are limited to 65535 pixels.");
    const chunks = [];

    const head = new Bytes(1024);
    head.ascii("GIF89a");
    head.word(W);
    head.word(H);
    head.byte(0x80 | (7 << 4) | (bits - 1)); // global colour table, 8-bit colour resolution
    head.byte(0); // background colour index
    head.byte(0); // pixel aspect ratio
    for (let i = 0; i < (1 << bits); i++) {
        head.byte(i < colors ? palette[i * 3] : 0);
        head.byte(i < colors ? palette[i * 3 + 1] : 0);
        head.byte(i < colors ? palette[i * 3 + 2] : 0);
    }
    if (frames.length > 1) {
        // NETSCAPE2.0 application extension: loop forever
        head.bytes([0x21, 0xff, 0x0b]);
        head.ascii("NETSCAPE2.0");
        head.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
    }
    chunks.push(head.take());

    const minCodeSize = Math.max(2, bits);
    frames.forEach((frame, i) => {
        const out = new Bytes();
        // Graphic control extension: no disposal, no transparency
        out.bytes([0x21, 0xf9, 0x04, 0x04]);
        out.word(delay);
        out.bytes([0x00, 0x00]);
        // Image descriptor: full frame, no local colour table
        out.byte(0x2c);
        out.word(0);
        out.word(0);
        out.word(W);
        out.word(H);
        out.byte(0);
        writeImageData(out, frame, width, height, scale, minCodeSize);
        chunks.push(out.take());
        onProgress?.(i + 1, frames.length);
    });

    chunks.push(new Uint8Array([0x3b])); // trailer
    return chunks;
}
