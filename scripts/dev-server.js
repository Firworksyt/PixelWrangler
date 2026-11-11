// Minimal static server for local development: `npm run dev`.
// Production uses nginx (see nginx.conf); this mirrors its security headers.
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

// Send the same security headers as production, so a blocked request shows up locally.
const HEADERS = Object.fromEntries(
    [...readFileSync(new URL("../nginx.conf", import.meta.url), "utf8")
        .matchAll(/^\s*add_header\s+(\S+)\s+"([^"]*)"\s+always;/gm)]
        .filter(([, name]) => name !== "Cache-Control")
        .map(([, name, value]) => [name, value]),
);
const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".png": "image/png",
};

// In Docker, version.json is written at build time. Locally, read it from git.
function gitVersion() {
    try {
        const [commit, commitDate] = execSync("git log -1 --format=%H%n%cI", { stdio: ["ignore", "pipe", "ignore"] })
            .toString().trim().split("\n");
        return { commit, commitDate, built: new Date().toISOString() };
    } catch {
        return { commit: "unknown", commitDate: "", built: new Date().toISOString() };
    }
}

createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/version.json") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(gitVersion()));
        return;
    }
    const file = normalize(join(ROOT, path.endsWith("/") ? `${path}index.html` : path));
    if (!file.startsWith(ROOT) && `${file}${sep}` !== ROOT) {
        res.writeHead(403).end();
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, {
            ...HEADERS,
            "Content-Type": TYPES[extname(file)] || "application/octet-stream",
            "Cache-Control": "no-store",
        });
        res.end(body);
    } catch {
        res.writeHead(404).end("Not found");
    }
}).listen(PORT, () => console.log(`Pixel Wrangler dev server: http://localhost:${PORT}`));
