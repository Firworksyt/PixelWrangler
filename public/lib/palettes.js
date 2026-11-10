// Palette list: defaults, Lospec lookup by name, and per-browser storage.

export const STORAGE_KEY = "pixelwrangler.palettes.v1";
export const MAX_COLORS = 256;

export const DEFAULT_PALETTES = [
    { slug: "slso8", name: "SLSO8", author: "Luis Miguel Maldonado",
        colors: ["0d2b45", "203c56", "544e68", "8d697a", "d08159", "ffaa5e", "ffd4a3", "ffecd6"] },
    { slug: "rust-gold-8", name: "Rust Gold 8", author: "Trigo Mathmancer",
        colors: ["f6cd26", "ac6b26", "563226", "331c17", "bb7f57", "725956", "393939", "202020"] },
    { slug: "gothic-bit", name: "Gothic Bit", author: "HiroHi",
        colors: ["0e0e12", "1a1a24", "333346", "535373", "8080a4", "a6a6bf", "c1c1d2", "e6e6ec"] },
    { slug: "sweetie-16", name: "Sweetie 16", author: "",
        colors: ["1a1c2c", "5d275d", "b13e53", "ef7d57", "ffcd75", "a7f070", "38b764", "257179",
            "29366f", "3b5dc9", "41a6f6", "73eff7", "f4f4f4", "94b0c2", "566c86", "333c57"] },
];

/**
 * Turn what someone typed into a Lospec slug. Accepts a slug ("nostalgic-dreams"),
 * a name ("Nostalgic Dreams") or a palette URL. Returns "" if nothing usable.
 */
export function parseSlug(input) {
    let s = String(input || "").trim();
    const m = s.match(/palette-list\/([^/?#]+)/i);
    if (m) s = m[1];
    return s
        .replace(/\.(json|hex|png|gpl|pal|ase|txt)$/i, "")
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

export function lospecUrl(slug) {
    return `https://lospec.com/palette-list/${slug}`;
}

/** Check and normalise a palette from Lospec's JSON. Throws on bad data. */
export function validatePalette(slug, data) {
    const colors = Array.isArray(data?.colors) ? data.colors.map((c) => String(c).toLowerCase()) : [];
    if (!colors.length || colors.some((c) => !/^[0-9a-f]{6}$/.test(c))) {
        throw new Error(`"${slug}" doesn't look like a valid palette.`);
    }
    if (colors.length > MAX_COLORS) throw new Error(`"${slug}" has more than ${MAX_COLORS} colours.`);
    return {
        slug,
        name: String(data.name || slug).slice(0, 80),
        author: String(data.author || "").slice(0, 80),
        colors,
    };
}

/** Fetch a palette from Lospec by slug. Only the slug leaves the browser. */
export async function fetchLospec(slug, fetchImpl = fetch) {
    let res;
    try {
        res = await fetchImpl(`${lospecUrl(slug)}.json`, { credentials: "omit", referrerPolicy: "no-referrer" });
    } catch {
        // Lospec's 404 for an unknown name has no CORS header, so the browser
        // reports it as a network error. We can't tell the two apart.
        throw new Error(
            `Couldn't load "${slug}" from Lospec. Check the name matches the end of the palette's Lospec URL.`,
        );
    }
    if (res.status === 404) throw new Error(`Lospec has no palette called "${slug}".`);
    if (!res.ok) throw new Error(`Lospec returned an error (${res.status}). Try again in a bit.`);
    let data;
    try {
        data = await res.json();
    } catch {
        throw new Error("Lospec sent something that isn't a palette.");
    }
    return validatePalette(slug, data);
}

function storageOrNull(storage) {
    try {
        return storage ?? globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** The saved palette list, or the defaults if none is saved (or storage is unavailable). */
export function loadPalettes(storage) {
    const store = storageOrNull(storage);
    try {
        const raw = store?.getItem(STORAGE_KEY);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
                return list.flatMap((p) => {
                    try {
                        return [validatePalette(parseSlug(p.slug), p)];
                    } catch {
                        return [];
                    }
                });
            }
        }
    } catch {
        // fall through to defaults
    }
    return DEFAULT_PALETTES.map((p) => ({ ...p, colors: [...p.colors] }));
}

export function savePalettes(list, storage) {
    try {
        storageOrNull(storage)?.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
        // private mode / storage full: the list just won't persist
    }
}
