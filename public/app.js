import { RATIOS, UPSCALE, cropBox, hexPalette, indicesToRGB, indicesToRGBA, targetSize, upscaleRGBA } from "./lib/pipeline.js";
import { DEFAULT_PALETTES, fetchLospec, loadPalettes, lospecUrl, parseSlug, savePalettes } from "./lib/palettes.js";
import { delayFor } from "./lib/gif.js";
import { DEFAULT_FPS, frameDelayLabel, frameTimes, isVideoFile, parseFps } from "./lib/media.js";
import { openVideo, seekTo } from "./video.js";

const $ = (sel) => document.querySelector(sel);

const els = {
    drop: $("#drop"),
    fileInput: $("#file"),
    browse: $("#browse"),
    dropMsg: $("#drop-msg"),
    workMsg: $("#work-msg"),
    workspace: $("#workspace"),
    stage: $("#stage"),
    preview: $("#preview"),
    previewVideo: $("#preview-video"),
    cropbox: $("#cropbox"),
    ratios: $("#ratios"),
    orient: $("#orient"),
    recenter: $("#recenter"),
    dragHint: $("#drag-hint"),
    fpsField: $("#fps-field"),
    fps: $("#fps"),
    fpsHint: $("#fps-hint"),
    metaSource: $("#meta-source"),
    metaFramesRow: $("#meta-frames-row"),
    metaFrames: $("#meta-frames"),
    metaPixels: $("#meta-pixels"),
    metaOut: $("#meta-out"),
    change: $("#change"),
    gallery: $("#gallery"),
    addForm: $("#add-form"),
    addInput: $("#add-input"),
    addBtn: $("#add-btn"),
    addMsg: $("#add-msg"),
    reset: $("#reset"),
    empty: $("#gallery-empty"),
    dragOverlay: $("#drag-overlay"),
    version: $("#version"),
};

const state = {
    media: null, // { kind: "image" | "video", name, url, width, height, duration?, el? }
    ratio: "2:1",
    portrait: false,
    pos: 0.5,
    fps: DEFAULT_FPS,
    palettes: loadPalettes(),
    results: new Map(), // slug -> { w, h, frames: [indices], pal, delay } for the current key
    key: "",
    job: 0,
    extract: null, // video frame reading in progress: { job, key, total, sent, acked, done, wake }
};

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

const isVideo = () => state.media?.kind === "video";

// ---------- opening files ----------

function openFile(file) {
    if (!file) return;
    const kind = isVideoFile(file) ? "video" : !file.type || file.type.startsWith("image/") ? "image" : null;
    if (!kind) {
        showDropError("That file isn't an image or a video.");
        return;
    }
    closeMedia();
    const media = { kind, name: baseName(file.name || kind), url: URL.createObjectURL(file), width: 0, height: 0 };
    state.media = media;
    state.pos = 0.5;
    els.dropMsg.textContent = "Opening…";
    els.dropMsg.classList.remove("error");
    setStatus("");
    syncGallery();
    if (kind === "image") {
        worker.postMessage({ type: "load", file });
    } else {
        openVideo(media.url).then(
            ({ el, width, height, duration }) => {
                if (state.media !== media) return;
                Object.assign(media, { el, width, height, duration });
                onLoaded();
            },
            () => {
                if (state.media === media) onLoadError();
            },
        );
    }
}

function closeMedia() {
    stopExtraction();
    state.key = "";
    state.results.clear();
    const old = state.media;
    state.media = null;
    if (!old) return;
    els.previewVideo.pause();
    els.previewVideo.removeAttribute("src");
    els.preview.removeAttribute("src");
    old.el?.removeAttribute("src");
    URL.revokeObjectURL(old.url);
}

function onLoaded() {
    const m = state.media;
    const video = isVideo();
    els.preview.hidden = video;
    els.previewVideo.hidden = !video;
    if (video) {
        els.previewVideo.src = m.url;
        els.previewVideo.play().catch(() => {});
    } else {
        els.preview.src = m.url;
    }
    els.drop.hidden = true;
    els.workspace.hidden = false;
    els.dropMsg.textContent = "";
    els.fpsField.hidden = !video;
    els.metaFramesRow.hidden = !video;
    els.metaSource.textContent = video
        ? `${m.width} × ${m.height} · ${m.duration.toFixed(1)} s`
        : `${m.width} × ${m.height}`;
    updateCrop();
    render();
}

function onLoadError() {
    const video = isVideo();
    closeMedia();
    els.workspace.hidden = true;
    els.drop.hidden = false;
    showDropError(video
        ? "This browser can't play that video. iPhone HEVC videos often only play in Safari, so try an MP4 (H.264) or WebM."
        : "This browser couldn't open that file. iPhone HEIC photos only open in Safari, so convert to JPEG or PNG first.");
    syncGallery();
}

// Shown in the drop box, or under the controls when something is open.
function showDropError(text) {
    for (const el of [els.dropMsg, els.workMsg]) {
        el.textContent = text;
        el.classList.add("error");
    }
}

function setStatus(text) {
    els.workMsg.textContent = text;
    els.workMsg.classList.remove("error");
}

function baseName(name) {
    return name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 60) || "image";
}

// ---------- crop ----------

function size() {
    return targetSize(state.ratio, state.portrait);
}

function currentBox() {
    const { w, h } = size();
    return cropBox(state.media.width, state.media.height, w, h, state.pos);
}

function previewEl() {
    return isVideo() ? els.previewVideo : els.preview;
}

function updateCrop() {
    if (!state.media?.width) return;
    const { width: W, height: H } = state.media;
    const b = currentBox();
    Object.assign(els.cropbox.style, {
        left: `${(b.x / W) * 100}%`,
        top: `${(b.y / H) * 100}%`,
        width: `${(b.w / W) * 100}%`,
        height: `${(b.h / H) * 100}%`,
    });
    const slack = b.axis === "x" ? W - b.w : H - b.h;
    els.cropbox.dataset.axis = slack > 0 ? b.axis : "none";
    els.dragHint.hidden = slack === 0;
    els.recenter.disabled = state.pos === 0.5 || slack === 0;

    const { w, h } = size();
    els.metaPixels.textContent = `${w} × ${h}`;
    els.metaOut.textContent = `${w * UPSCALE} × ${h * UPSCALE} ${isVideo() ? "GIF" : "PNG"}`;
    updateFrameMeta();
    for (const btn of els.ratios.querySelectorAll("button")) {
        btn.setAttribute("aria-pressed", String(btn.dataset.ratio === state.ratio));
        const [rw, rh] = btn.dataset.ratio.split(":");
        btn.textContent = state.portrait && rw !== rh ? `${rh}:${rw}` : btn.dataset.ratio;
    }
    for (const btn of els.orient.querySelectorAll("button")) {
        btn.setAttribute("aria-pressed", String((btn.dataset.orient === "portrait") === state.portrait));
    }
    els.orient.classList.toggle("disabled", state.ratio === "1:1");
    els.gallery.style.setProperty("--ar", `${w} / ${h}`);
    els.gallery.style.setProperty("--card-min", `${Math.max(220, Math.round(340 * Math.min(1, w / h / 1.3)))}px`);
}

function updateFrameMeta() {
    if (!isVideo()) return;
    els.fpsHint.textContent = frameDelayLabel(state.fps);
    els.metaFrames.textContent = String(frameTimes(state.media.duration, state.fps).length);
}

let drag = null;

els.stage.addEventListener("pointerdown", (e) => {
    if (!state.media?.width || els.cropbox.dataset.axis === "none") return;
    const b = currentBox();
    const scale = state.media.width / previewEl().clientWidth;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, box: b, scale };
    els.stage.setPointerCapture(e.pointerId);
    els.stage.classList.add("dragging");
    e.preventDefault();
});

els.stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { box, scale } = drag;
    const { width: W, height: H } = state.media;
    if (box.axis === "x") {
        const slack = W - box.w;
        state.pos = clamp01((box.x + (e.clientX - drag.x) * scale) / slack);
    } else {
        const slack = H - box.h;
        state.pos = clamp01((box.y + (e.clientY - drag.y) * scale) / slack);
    }
    updateCrop();
});

function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    els.stage.classList.remove("dragging");
    render();
}
els.stage.addEventListener("pointerup", endDrag);
els.stage.addEventListener("pointercancel", endDrag);

els.cropbox.addEventListener("keydown", (e) => {
    const axis = els.cropbox.dataset.axis;
    const back = axis === "x" ? "ArrowLeft" : "ArrowUp";
    const fwd = axis === "x" ? "ArrowRight" : "ArrowDown";
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 0.02;
    state.pos = clamp01(state.pos + (e.key === fwd ? step : -step));
    updateCrop();
    renderSoon();
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

els.ratios.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-ratio]");
    if (!btn || btn.dataset.ratio === state.ratio) return;
    state.ratio = btn.dataset.ratio;
    state.pos = 0.5;
    updateCrop();
    render();
});

els.orient.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-orient]");
    if (!btn || state.ratio === "1:1") return;
    const portrait = btn.dataset.orient === "portrait";
    if (portrait === state.portrait) return;
    state.portrait = portrait;
    state.pos = 0.5;
    updateCrop();
    render();
});

els.recenter.addEventListener("click", () => {
    state.pos = 0.5;
    updateCrop();
    render();
});

els.fps.addEventListener("input", () => {
    const fps = parseFps(els.fps.value);
    els.fps.classList.toggle("invalid", !fps);
    if (!fps || fps === state.fps) return;
    state.fps = fps;
    updateFrameMeta();
    // Old results are now stale: stop showing them as ready while the user is still typing.
    stopExtraction();
    state.key = "";
    state.results.clear();
    syncGallery();
    renderSoon(500);
});

// ---------- rendering ----------

let renderTimer = 0;
function renderSoon(ms = 200) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, ms);
}

/** Bring every palette card up to date with the current media and crop. */
function render() {
    clearTimeout(renderTimer);
    if (!state.media?.width) {
        syncGallery();
        return;
    }
    const { w, h } = size();
    const key = isVideo() ? `${w}x${h}@${state.pos}@${state.fps}` : `${w}x${h}@${state.pos}`;
    if (key !== state.key) {
        state.key = key;
        state.results.clear();
        if (isVideo()) startExtraction(key, w, h);
    }
    syncGallery();
    if (isVideo() && !state.extract?.done) return; // palettes are requested once all frames are read
    requestMissing();
}

/** Ask the worker for every palette that has no result yet for the current key. */
function requestMissing() {
    const missing = state.palettes.filter((p) => !state.results.has(p.slug));
    if (!missing.length) {
        if (isVideo()) setStatus("");
        return;
    }
    state.job += 1;
    const palettes = missing.map(({ slug, colors }) => ({ slug, colors }));
    if (isVideo()) {
        setStatus("Dithering frames…");
        worker.postMessage({ type: "render-video", job: state.job, key: state.key, palettes });
    } else {
        const { w, h } = size();
        worker.postMessage({ type: "render", job: state.job, key: state.key, w, h, pos: state.pos, palettes });
    }
}

// Video frames are read one at a time on this thread (only it can decode video)
// and resized in the worker. A few frames may be in flight at once.
const IN_FLIGHT = 3;
let extractChain = Promise.resolve();

function startExtraction(key, w, h) {
    stopExtraction();
    const media = state.media;
    const times = frameTimes(media.duration, state.fps);
    const job = ++state.job;
    const ex = { job, key, total: times.length, sent: 0, acked: 0, done: false, wake: null };
    state.extract = ex;
    worker.postMessage({ type: "video-start", job, key, count: times.length, w, h, pos: state.pos });
    setStatus(`Reading frames 0 / ${ex.total}`);

    const live = () => state.extract === ex;
    extractChain = extractChain.then(async () => {
        try {
            for (const t of times) {
                if (!live()) return;
                await seekTo(media.el, t);
                if (!live()) return;
                const bitmap = await createImageBitmap(media.el);
                while (live() && ex.sent - ex.acked >= IN_FLIGHT) await new Promise((r) => (ex.wake = r));
                if (!live()) {
                    bitmap.close();
                    return;
                }
                worker.postMessage({ type: "video-frame", job, index: ex.sent++, bitmap }, [bitmap]);
            }
        } catch {
            if (live()) showDropError("Couldn't read the frames of that video in this browser.");
        }
    });
}

function stopExtraction() {
    const ex = state.extract;
    state.extract = null;
    ex?.wake?.();
}

function onFrameDone(job) {
    const ex = state.extract;
    if (ex?.job !== job) return;
    ex.acked += 1;
    ex.wake?.();
    ex.wake = null;
    setStatus(`Reading frames ${ex.acked} / ${ex.total}`);
    if (ex.acked === ex.total) {
        ex.done = true;
        requestMissing();
    }
}

worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "loaded") {
        if (state.media?.kind !== "image") return;
        Object.assign(state.media, { width: msg.width, height: msg.height });
        onLoaded();
    } else if (msg.type === "load-error") {
        if (state.media?.kind === "image") onLoadError();
    } else if (msg.type === "frame-done") {
        onFrameDone(msg.job);
    } else if (msg.type === "result" && msg.key === state.key) {
        const p = state.palettes.find((x) => x.slug === msg.slug);
        if (!p) return;
        state.results.set(msg.slug, {
            w: msg.w, h: msg.h, frames: msg.frames, pal: hexPalette(p.colors), delay: delayFor(state.fps), shown: -1,
        });
        drawCard(msg.slug);
        if (isVideo() && state.palettes.every((x) => state.results.has(x.slug))) setStatus("");
    }
};

worker.onerror = () => {
    showDropError("Something went wrong processing that file. Try reloading the page.");
};

// ---------- gallery ----------

const cards = new Map(); // slug -> { el, canvas, download, label }

function syncGallery() {
    const wanted = new Set(state.palettes.map((p) => p.slug));
    for (const [slug, card] of cards) {
        if (!wanted.has(slug)) {
            card.el.remove();
            cards.delete(slug);
        }
    }
    for (const p of state.palettes) {
        if (!cards.has(p.slug)) cards.set(p.slug, makeCard(p));
        els.gallery.append(cards.get(p.slug).el); // keeps DOM order = list order
        drawCard(p.slug);
    }
    els.empty.hidden = state.palettes.length > 0;
}

function makeCard(p) {
    const tpl = $("#card-template").content.firstElementChild.cloneNode(true);
    const link = tpl.querySelector(".card-name");
    link.textContent = p.name;
    link.href = lospecUrl(p.slug);
    tpl.querySelector(".card-author").textContent = p.author ? `by ${p.author}` : "";
    tpl.querySelector(".card-count").textContent = `${p.colors.length} colours`;
    const sw = tpl.querySelector(".swatches");
    for (const c of p.colors) {
        const s = document.createElement("span");
        s.style.background = `#${c}`;
        s.title = `#${c}`;
        sw.append(s);
    }
    const canvas = tpl.querySelector("canvas");
    canvas.setAttribute("aria-label", `Preview in the ${p.name} palette`);
    const download = tpl.querySelector(".download");
    download.addEventListener("click", () => downloadResult(p));
    tpl.querySelector(".remove").addEventListener("click", () => removePalette(p.slug));
    tpl.querySelector(".remove").setAttribute("aria-label", `Remove ${p.name}`);
    return { el: tpl, canvas, download, label: download.querySelector(".download-label"), busy: false };
}

function drawCard(slug) {
    const card = cards.get(slug);
    if (!card) return;
    const res = state.results.get(slug);
    card.el.classList.toggle("pending", Boolean(state.media) && !res);
    card.el.classList.toggle("blank", !state.media);
    if (!card.busy) {
        card.download.disabled = !res;
        card.label.textContent = isVideo() ? "Download GIF" : "Download";
    }
    if (res) drawFrame(card, res, currentFrame(res));
}

function drawFrame(card, res, i) {
    const { canvas } = card;
    if (canvas.width !== res.w || canvas.height !== res.h) {
        canvas.width = res.w;
        canvas.height = res.h;
    }
    canvas.getContext("2d").putImageData(new ImageData(indicesToRGBA(res.frames[i], res.pal), res.w, res.h), 0, 0);
    res.shown = i;
}

// Video previews loop in step with each other, at the GIF's own frame timing.
const animStart = performance.now();
function currentFrame(res, now = performance.now()) {
    return res.frames.length > 1 ? Math.floor((now - animStart) / (res.delay * 10)) % res.frames.length : 0;
}

function animate(now) {
    for (const [slug, res] of state.results) {
        if (res.frames.length < 2) continue;
        const i = currentFrame(res, now);
        if (i !== res.shown) {
            const card = cards.get(slug);
            if (card) drawFrame(card, res, i);
        }
    }
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

function downloadResult(p) {
    const res = state.results.get(p.slug);
    if (!res) return;
    if (isVideo()) downloadGif(p, res);
    else downloadPng(p, res);
}

function downloadPng(p, res) {
    const W = res.w * UPSCALE, H = res.h * UPSCALE;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const rgb = indicesToRGB(res.frames[0], res.pal);
    canvas.getContext("2d").putImageData(new ImageData(upscaleRGBA(rgb, res.w, res.h), W, H), 0, 0);
    const name = `${state.media.name}-${p.slug}.png`;
    canvas.toBlob((blob) => blob && saveBlob(blob, name), "image/png");
}

function downloadGif(p, res) {
    const card = cards.get(p.slug);
    if (!card || card.busy) return;
    const name = `${state.media.name}-${p.slug}.gif`;
    const setBusy = (busy, text) => {
        card.busy = busy;
        card.download.disabled = busy;
        card.label.textContent = text;
    };
    setBusy(true, "GIF 0%");
    const gw = new Worker(new URL("./gif-worker.js", import.meta.url), { type: "module" });
    const finish = () => {
        gw.terminate();
        setBusy(false, "Download GIF");
        drawCard(p.slug);
    };
    gw.onmessage = (e) => {
        if (e.data.type === "progress") {
            card.label.textContent = `GIF ${Math.floor((e.data.done / e.data.total) * 100)}%`;
        } else if (e.data.type === "done") {
            saveBlob(e.data.blob, name);
            finish();
        }
    };
    gw.onerror = () => {
        finish();
        showDropError("Couldn't build that GIF. It may be too large for this browser's memory.");
    };
    gw.postMessage({ width: res.w, height: res.h, palette: res.pal, frames: res.frames, scale: UPSCALE, delay: res.delay });
}

function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function removePalette(slug) {
    state.palettes = state.palettes.filter((p) => p.slug !== slug);
    state.results.delete(slug);
    savePalettes(state.palettes);
    syncGallery();
}

els.addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const slug = parseSlug(els.addInput.value);
    if (!slug) {
        setAddMsg("Type a Lospec palette name, like nostalgic-dreams.", true);
        return;
    }
    if (state.palettes.some((p) => p.slug === slug)) {
        setAddMsg(`"${slug}" is already in your list.`, true);
        return;
    }
    els.addBtn.disabled = true;
    setAddMsg(`Looking up "${slug}"…`);
    try {
        const palette = await fetchLospec(slug);
        if (!state.palettes.some((p) => p.slug === slug)) {
            state.palettes.push(palette);
            savePalettes(state.palettes);
        }
        els.addInput.value = "";
        setAddMsg(`Added ${palette.name}.`);
        render();
        cards.get(slug)?.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
        setAddMsg(err.message, true);
    } finally {
        els.addBtn.disabled = false;
    }
});

function setAddMsg(text, isError = false) {
    els.addMsg.textContent = text;
    els.addMsg.classList.toggle("error", isError);
}

els.reset.addEventListener("click", () => {
    if (!confirm("Replace your palette list with the four defaults?")) return;
    state.palettes = DEFAULT_PALETTES.map((p) => ({ ...p, colors: [...p.colors] }));
    savePalettes(state.palettes);
    setAddMsg("");
    render();
});

// ---------- file input, drag & drop, paste ----------

els.browse.addEventListener("click", () => els.fileInput.click());
els.change.addEventListener("click", () => els.fileInput.click());
els.drop.addEventListener("click", (e) => {
    if (!e.target.closest("button")) els.fileInput.click();
});
els.fileInput.addEventListener("change", () => {
    openFile(els.fileInput.files[0]);
    els.fileInput.value = "";
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    dragDepth += 1;
    els.dragOverlay.hidden = false;
});
window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.dragOverlay.hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.dragOverlay.hidden = true;
    openFile(e.dataTransfer?.files[0]);
});
// Ctrl/Cmd+V anywhere except the palette and frame rate boxes.
window.addEventListener("paste", (e) => {
    if (e.target === els.addInput || e.target === els.fps) return;
    const item = [...(e.clipboardData?.items || [])]
        .find((i) => i.kind === "file" && (i.type.startsWith("image/") || i.type.startsWith("video/")));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    openFile(new File([file], file.name || "pasted", { type: file.type }));
});

// Paste buttons read the clipboard directly (needed on touch devices).
const PASTE_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘V" : "Ctrl+V";

async function pasteFromClipboard() {
    if (!navigator.clipboard?.read) {
        showDropError(`Your browser doesn't allow paste buttons. Press ${PASTE_SHORTCUT} instead.`);
        return;
    }
    try {
        for (const item of await navigator.clipboard.read()) {
            const type = item.types.find((t) => t.startsWith("image/"));
            if (type) {
                const blob = await item.getType(type);
                openFile(new File([blob], "pasted-image", { type }));
                return;
            }
        }
        showDropError("There's no image on your clipboard. Copy an image first, then paste.");
    } catch {
        showDropError(`Couldn't read the clipboard. Allow clipboard access, or press ${PASTE_SHORTCUT}.`);
    }
}

for (const btn of document.querySelectorAll(".paste-btn")) btn.addEventListener("click", pasteFromClipboard);
for (const el of document.querySelectorAll(".paste-key")) el.textContent = PASTE_SHORTCUT;

// ---------- theme ----------

const themeBtn = $("#theme-toggle");
function currentTheme() {
    return document.documentElement.dataset.theme ||
        (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
function syncThemeButton() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    themeBtn.setAttribute("aria-label", `Switch to ${next} mode`);
    themeBtn.title = `Switch to ${next} mode`;
}
themeBtn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
        localStorage.setItem("pixelwrangler.theme", next);
    } catch {
        // not persisted; fine
    }
    syncThemeButton();
});
matchMedia("(prefers-color-scheme: light)").addEventListener("change", syncThemeButton);
syncThemeButton();

// ---------- start ----------

for (const ratio of Object.keys(RATIOS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.ratio = ratio;
    b.textContent = ratio;
    els.ratios.append(b);
}
els.fps.value = String(DEFAULT_FPS);
els.previewVideo.muted = true;
syncGallery();

// Footer: "v<hash> · <commit date>", the hash linking to the commit on GitHub.
fetch("version.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => {
        if (!v?.commit || v.commit === "unknown") return;
        const link = document.createElement("a");
        link.href = `https://github.com/firworksyt/PixelWrangler/commit/${v.commit}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `v${v.commit.slice(0, 7)}`;
        els.version.append(link);
        const date = new Date(v.commitDate || v.built);
        if (!Number.isNaN(date.getTime())) {
            const formatted = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            els.version.append(` · ${formatted}`);
        }
    })
    .catch(() => {});
