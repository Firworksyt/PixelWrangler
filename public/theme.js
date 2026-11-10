// Apply the saved light/dark choice before first paint (loaded as a blocking script).
try {
    const t = localStorage.getItem("pixelwrangler.theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
    // storage blocked: follow the system theme
}
