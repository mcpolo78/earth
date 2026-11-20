import { describe, it, expect } from "vitest";
import * as µ from "../src/micro.js";

describe("micro", () => {
    it("floorMod", () => {
        expect(µ.floorMod(11, 10)).toBe(1);
        expect(µ.floorMod(-1, 10)).toBe(9);
        expect(µ.floorMod(-1e-16, 10)).toBe(0);
    });
    it("clamp / proportion / spread", () => {
        expect(µ.clamp(5, 0, 3)).toBe(3);
        expect(µ.proportion(15, 10, 20)).toBe(0.5);
        expect(µ.spread(0.5, 10, 20)).toBe(15);
    });
    it("zeroPad / capitalize", () => {
        expect(µ.zeroPad(7, 3)).toBe("007");
        expect(µ.capitalize("abc")).toBe("Abc");
    });
    it("ymdRedelimit / dateToConfig", () => {
        expect(µ.ymdRedelimit("20140131", "", "/")).toBe("2014/01/31");
        expect(µ.ymdRedelimit("2014-01-31T00:00", "-", "")).toBe("20140131");
        expect(µ.dateToConfig(new Date(Date.UTC(2026, 10, 20, 21)))).toEqual({date: "2026/11/20", hour: "2100"});
    });
    it("formatVector gives into-the-wind direction", () => {
        const units = {conversion: x => x, precision: 1};
        expect(µ.formatVector([0, -10, 10], units)).toBe("0° @ 10.0");  // wind from the north
        expect(µ.formatVector([10, 0, 10], units)).toBe("270° @ 10.0");  // wind from the west
    });
    it("segmentedColorScale interpolates", () => {
        const scale = µ.segmentedColorScale([[0, [0, 0, 0]], [10, [100, 200, 250]]]);
        expect(scale(5, 255)).toEqual([50, 100, 125, 255]);
    });
    it("parse reads a full hash", () => {
        const r = µ.parse("2013/11/14/0900Z/wind/isobaric/1000hPa/orthographic=26.50,-153.00,1430/overlay=temp/grid=on",
            new Set(["orthographic"]), new Set(["temp"]));
        expect(r).toMatchObject({date: "2013/11/14", hour: "0900", param: "wind", surface: "isobaric",
            level: "1000hPa", projection: "orthographic", orientation: "26.50,-153.00,1430",
            overlayType: "temp", showGridPoints: true});
    });
    it("parse ignores unknown projections and overlays", () => {
        const r = µ.parse("current/wind/surface/level/foo=1,2/overlay=bar", new Set(["orthographic"]), new Set());
        expect(r).toMatchObject({date: "current", hour: "", projection: "orthographic", overlayType: "default"});
    });
});

describe("agent", () => {
    it("keeps only the latest submitted task", async () => {
        const agent = µ.newAgent();
        const values = [];
        agent.on("update", v => values.push(v));
        agent.submit(x => x * 2, 1);
        agent.submit(x => x * 2, Promise.resolve(21));
        await new Promise(r => setTimeout(r, 20));
        expect(values).toEqual([42]);
        expect(agent.value()).toBe(42);
    });
    it("emits reject on failure", async () => {
        const agent = µ.newAgent();
        let error = null;
        agent.on("reject", e => { error = e; });
        agent.submit(() => { throw "boom"; });
        await new Promise(r => setTimeout(r, 20));
        expect(error).toBe("boom");
    });
});

describe("binary layers", () => {
    it("parses the EGB1 format written by fetch_gfs.py", () => {
        const headers = [{nx: 2, ny: 1, la1: 0}, {nx: 2, ny: 1, la1: 0}];
        const json = new TextEncoder().encode(JSON.stringify(headers));
        const padding = (4 - (8 + json.length) % 4) % 4;
        const buffer = new ArrayBuffer(8 + json.length + padding + 4 * 4);
        const bytes = new Uint8Array(buffer);
        bytes.set([69, 71, 66, 49]);  // "EGB1"
        new DataView(buffer).setUint32(4, json.length, true);
        bytes.set(json, 8);
        new Float32Array(buffer, 8 + json.length + padding, 4).set([1.5, NaN, -2, 3]);
        const records = µ.parseBinaryLayer(buffer);
        expect(records).toHaveLength(2);
        expect(records[0].header).toEqual(headers[0]);
        expect(Array.from(records[0].data)).toEqual([1.5, NaN]);
        expect(Array.from(records[1].data)).toEqual([-2, 3]);
    });
    it("rejects other files", () => {
        expect(() => µ.parseBinaryLayer(new ArrayBuffer(16))).toThrow();
    });
});
