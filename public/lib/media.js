// Helpers for video input: telling videos apart and choosing which moments to sample.

import { delayFor } from "./gif.js";

export const DEFAULT_FPS = 4;
export const MAX_FPS = 50; // GIF can't show frames faster than 2/100 s

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|avi)$/i;

export function isVideoFile(file) {
    return Boolean(file?.type?.startsWith("video/") || (!file?.type && VIDEO_EXT.test(file?.name || "")));
}

/** A frame rate from the input box, or null if it isn't usable. */
export function parseFps(value) {
    const fps = Number(String(value).trim().replace(",", "."));
    return Number.isFinite(fps) && fps > 0 && fps <= MAX_FPS ? fps : null;
}

/** "0.25 s/frame", using the delay the GIF will actually have. */
export function frameDelayLabel(fps) {
    return `${(delayFor(fps) / 100).toFixed(2)} s/frame`;
}

/**
 * Times (seconds) to grab frames at: 0, 1/fps, 2/fps, ... while still inside the clip.
 * Always at least one frame.
 */
export function frameTimes(duration, fps) {
    const count = Math.max(1, Math.floor(duration * fps + 1e-6));
    return Array.from({ length: count }, (_, i) => Math.min(i / fps, Math.max(0, duration - 0.001)));
}
