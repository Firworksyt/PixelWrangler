import { RATIOS, UPSCALE, cropBox, targetSize, upscaleRGBA, rgbToRGBA } from "./lib/pipeline.js";
import { DEFAULT_PALETTES, fetchLospec, loadPalettes, lospecUrl, parseSlug, savePalettes } from "./lib/palettes.js";

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
    cropbox: $("#cropbox"),
    ratios: $("#ratios"),
    orient: $("#orient"),
    recenter: $("#recenter"),
    dragHint: $("#drag-hint"),
    metaSource: $("#meta-source"),
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
    image: null, // { name, width, height, url }
    ratio: "2:1",
    portrait: false,
    pos: 0.5,
    palettes: loadPalettes(),
    results: new Map(), // slug -> { rgb, w, h } for the current key
    key: "",
    job: 0,
};

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

// ---------- image loading ----------

function openFile(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
        showDropError("That file isn't an image.");
        return;
    }
    if (state.image?.url) URL.revokeObjectURL(state.image.url);
    state.image = { name: baseName(file.name || "image"), url: URL.createObjectURL(file), width: 0, height: 0 };
    state.pos = 0.5;
    state.key = "";
    state.results.clear();
    els.dropMsg.textContent = "Opening…";
    els.dropMsg.classList.remove("error");
    els.workMsg.textContent = "";
    syncGallery();
    worker.postMessage({ type: "load", file });
}

function onLoaded(width, height) {
    Object.assign(state.image, { width, height });
    els.preview.src = state.image.url;
    els.drop.hidden = true;
    els.workspace.hidden = false;
    els.dropMsg.textContent = "";
    els.metaSource.textContent = `${width} × ${height}`;
    updateCrop();
    render();
}

function onLoadError() {
    if (state.image?.url) URL.revokeObjectURL(state.image.url);
    state.image = null;
    els.workspace.hidden = true;
    els.drop.hidden = false;
    showDropError(
        "This browser couldn't open that file. iPhone HEIC photos only open in Safari, so convert to JPEG or PNG first.",
    );
    syncGallery();
}

// Shown in the drop box, or under the controls when an image is open.
function showDropError(text) {
    for (const el of [els.dropMsg, els.workMsg]) {
        el.textContent = text;
        el.classList.add("error");
    }
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
    return cropBox(state.image.width, state.image.height, w, h, state.pos);
}

function updateCrop() {
    if (!state.image?.width) return;
    const { width: W, height: H } = state.image;
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
    els.metaOut.textContent = `${w * UPSCALE} × ${h * UPSCALE}`;
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

let drag = null;

els.stage.addEventListener("pointerdown", (e) => {
    if (!state.image?.width || els.cropbox.dataset.axis === "none") return;
    const b = currentBox();
    const scale = state.image.width / els.preview.clientWidth;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, box: b, scale };
    els.stage.setPointerCapture(e.pointerId);
    els.stage.classList.add("dragging");
    e.preventDefault();
});

els.stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { box, scale } = drag;
    const { width: W, height: H } = state.image;
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

// ---------- rendering ----------

let renderTimer = 0;
function renderSoon() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 200);
}

/** Ask the worker for every palette that has no result yet for the current crop. */
function render() {
    clearTimeout(renderTimer);
    if (!state.image?.width) {
        syncGallery();
        return;
    }
    const { w, h } = size();
    const key = `${w}x${h}@${state.pos}`;
    if (key !== state.key) {
        state.key = key;
        state.results.clear();
    }
    syncGallery();
    const missing = state.palettes.filter((p) => !state.results.has(p.slug));
    if (!missing.length) return;
    state.job += 1;
    worker.postMessage({
        type: "render", job: state.job, key, w, h, pos: state.pos,
        palettes: missing.map(({ slug, colors }) => ({ slug, colors })),
    });
}

worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "loaded") onLoaded(msg.width, msg.height);
    else if (msg.type === "load-error") onLoadError(msg.message);
    else if (msg.type === "result" && msg.key === state.key) {
        state.results.set(msg.slug, { rgb: msg.rgb, w: msg.w, h: msg.h });
        drawCard(msg.slug);
    }
};

worker.onerror = () => {
    showDropError("Something went wrong processing that image. Try reloading the page.");
};

// ---------- gallery ----------

const cards = new Map(); // slug -> { el, canvas, download }

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
    canvas.setAttribute("aria-label", `Image in the ${p.name} palette`);
    const download = tpl.querySelector(".download");
    download.addEventListener("click", () => downloadPng(p));
    tpl.querySelector(".remove").addEventListener("click", () => removePalette(p.slug));
    tpl.querySelector(".remove").setAttribute("aria-label", `Remove ${p.name}`);
    return { el: tpl, canvas, download };
}

function drawCard(slug) {
    const card = cards.get(slug);
    if (!card) return;
    const res = state.results.get(slug);
    card.el.classList.toggle("pending", Boolean(state.image) && !res);
    card.el.classList.toggle("blank", !state.image);
    card.download.disabled = !res;
    if (!res) return;
    const { canvas } = card;
    canvas.width = res.w;
    canvas.height = res.h;
    canvas.getContext("2d").putImageData(new ImageData(rgbToRGBA(res.rgb), res.w, res.h), 0, 0);
}

function downloadPng(p) {
    const res = state.results.get(p.slug);
    if (!res) return;
    const W = res.w * UPSCALE, H = res.h * UPSCALE;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.getContext("2d").putImageData(new ImageData(upscaleRGBA(res.rgb, res.w, res.h), W, H), 0, 0);
    canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${state.image.name}-${p.slug}.png`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }, "image/png");
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
// Ctrl/Cmd+V anywhere except the palette box.
window.addEventListener("paste", (e) => {
    if (e.target === els.addInput) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    openFile(new File([file], file.name || "pasted-image", { type: file.type }));
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
