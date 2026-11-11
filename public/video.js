// Reading frames out of a video with the browser's own decoder.

/** Load a video URL far enough to know its size and length. Rejects if it can't be played. */
export function openVideo(url) {
    return new Promise((resolve, reject) => {
        const el = document.createElement("video");
        el.muted = true;
        el.playsInline = true;
        el.preload = "auto";
        const fail = () => reject(new Error("unsupported video"));
        el.addEventListener("error", fail, { once: true });
        el.addEventListener("loadeddata", async () => {
            el.removeEventListener("error", fail);
            if (!el.videoWidth || !el.videoHeight) {
                fail(); // e.g. a codec the browser can only play the audio of
                return;
            }
            let duration = el.duration;
            if (!Number.isFinite(duration)) {
                // Some WebM files don't record their length; seeking far ahead reveals it.
                await seekTo(el, 1e9);
                duration = el.duration;
            }
            resolve({ el, width: el.videoWidth, height: el.videoHeight, duration: Number.isFinite(duration) ? duration : 0 });
        }, { once: true });
        el.src = url;
    });
}

/** Seek and wait until that frame is ready to draw. */
export function seekTo(el, time) {
    return new Promise((resolve, reject) => {
        const done = () => {
            el.removeEventListener("error", failed);
            resolve();
        };
        const failed = () => {
            el.removeEventListener("seeked", done);
            reject(new Error("seek failed"));
        };
        el.addEventListener("seeked", done, { once: true });
        el.addEventListener("error", failed, { once: true });
        el.currentTime = time;
    });
}
