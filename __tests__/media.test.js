import { frameDelayLabel, frameTimes, isVideoFile, parseFps } from "../public/lib/media.js";

describe("isVideoFile", () => {
    test.each([
        [{ type: "video/mp4", name: "a.mp4" }, true],
        [{ type: "video/webm", name: "a" }, true],
        [{ type: "", name: "clip.MOV" }, true],
        [{ type: "image/png", name: "a.png" }, false],
        [{ type: "image/gif", name: "a.mp4" }, false],
        [{ type: "", name: "notes.txt" }, false],
        [null, false],
    ])("%j -> %s", (file, want) => {
        expect(isVideoFile(file)).toBe(want);
    });
});

describe("parseFps", () => {
    test.each([["4", 4], ["2.5", 2.5], ["2,5", 2.5], [" 10 ", 10], ["50", 50], ["0.1", 0.1]])("%j -> %s", (v, want) => {
        expect(parseFps(v)).toBe(want);
    });
    test.each(["", "0", "-1", "51", "abc", "Infinity"])("%j is rejected", (v) => {
        expect(parseFps(v)).toBeNull();
    });
});

describe("frameDelayLabel", () => {
    test.each([[4, "0.25 s/frame"], [2, "0.50 s/frame"], [3, "0.33 s/frame"], [1, "1.00 s/frame"]])("%s fps", (fps, want) => {
        expect(frameDelayLabel(fps)).toBe(want);
    });
});

describe("frameTimes", () => {
    test("samples every 1/fps seconds inside the clip", () => {
        expect(frameTimes(2, 4)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
    });

    test("an exact fit doesn't add a frame past the end", () => {
        expect(frameTimes(8.661, 4)).toHaveLength(34);
    });

    test("a clip shorter than one frame still gives one frame", () => {
        expect(frameTimes(0.1, 2)).toEqual([0]);
    });

    test("a zero-length clip gives one frame at 0", () => {
        expect(frameTimes(0, 4)).toEqual([0]);
    });

    test("no time is at or past the end", () => {
        for (const t of frameTimes(3, 10)) expect(t).toBeLessThan(3);
    });
});
