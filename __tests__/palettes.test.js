import {
    DEFAULT_PALETTES, STORAGE_KEY, fetchLospec, loadPalettes, parseSlug, savePalettes, validatePalette,
} from "../public/lib/palettes.js";

function memoryStorage(initial = {}) {
    const data = { ...initial };
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        data,
    };
}

describe("parseSlug", () => {
    test.each([
        ["nostalgic-dreams", "nostalgic-dreams"],
        ["  Nostalgic Dreams ", "nostalgic-dreams"],
        ["SWEETIE_16", "sweetie-16"],
        ["https://lospec.com/palette-list/rust-gold-8", "rust-gold-8"],
        ["https://lospec.com/palette-list/slso8.json", "slso8"],
        ["lospec.com/palette-list/gothic-bit?foo=1", "gothic-bit"],
        ["../../etc", "etc"],
        ["", ""],
    ])("%j -> %j", (input, slug) => {
        expect(parseSlug(input)).toBe(slug);
    });
});

describe("validatePalette", () => {
    test("normalises colours and keeps name and author", () => {
        expect(validatePalette("x", { name: "X", author: "A", colors: ["ABCDEF"] }))
            .toEqual({ slug: "x", name: "X", author: "A", colors: ["abcdef"] });
    });

    test.each([[{}], [{ colors: [] }], [{ colors: ["12345"] }], [{ colors: ["zzzzzz"] }]])(
        "rejects %j", (data) => {
            expect(() => validatePalette("x", data)).toThrow();
        });
});

describe("fetchLospec", () => {
    const respond = (status, body) => async () => ({
        status, ok: status >= 200 && status < 300, json: async () => body,
    });

    test("returns a validated palette", async () => {
        const p = await fetchLospec("abc", respond(200, { name: "ABC", author: "", colors: ["000000"] }));
        expect(p).toEqual({ slug: "abc", name: "ABC", author: "", colors: ["000000"] });
    });

    test("explains a missing palette", async () => {
        await expect(fetchLospec("nope", respond(404, { error: "palette not found" })))
            .rejects.toThrow(/no palette called "nope"/);
    });

    test("explains a blocked or failed request", async () => {
        await expect(fetchLospec("abc", async () => { throw new TypeError("fail"); }))
            .rejects.toThrow(/Couldn't load "abc"/);
    });
});

describe("loadPalettes / savePalettes", () => {
    test("defaults when nothing is saved", () => {
        expect(loadPalettes(memoryStorage()).map((p) => p.slug)).toEqual(DEFAULT_PALETTES.map((p) => p.slug));
    });

    test("round-trips a saved list", () => {
        const store = memoryStorage();
        const list = [{ slug: "abc", name: "ABC", author: "", colors: ["123456"] }];
        savePalettes(list, store);
        expect(loadPalettes(store)).toEqual(list);
    });

    test("an empty saved list stays empty", () => {
        expect(loadPalettes(memoryStorage({ [STORAGE_KEY]: "[]" }))).toEqual([]);
    });

    test("corrupt storage falls back to defaults", () => {
        expect(loadPalettes(memoryStorage({ [STORAGE_KEY]: "{nope" })).length).toBe(DEFAULT_PALETTES.length);
    });

    test("drops invalid entries", () => {
        const store = memoryStorage({ [STORAGE_KEY]: JSON.stringify([{ slug: "a", colors: ["xx"] }]) });
        expect(loadPalettes(store)).toEqual([]);
    });

    test("broken storage doesn't throw", () => {
        const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
        expect(() => savePalettes([], broken)).not.toThrow();
        expect(loadPalettes(broken).length).toBe(DEFAULT_PALETTES.length);
    });
});
