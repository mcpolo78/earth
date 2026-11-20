import { describe, it, expect } from "vitest";
import { buildGrid, bilinearInterpolateScalar, lookupOscar, productsFor, overlayTypes } from "../src/products.js";

function grid(values, nx, ny) {
    return buildGrid({
        header: {lo1: 0, la1: 90, dx: 360 / nx, dy: 180 / (ny - 1), nx, ny, refTime: "2026-11-20T18:00:00.000Z",
            forecastTime: 3, center: 7},
        interpolate: bilinearInterpolateScalar,
        data: i => values[i]
    });
}

describe("products", () => {
    it("bilinear interpolation, including wrap-around at 360°", () => {
        // 4 x 3 grid: longitudes 0, 90, 180, 270; latitudes 90, 0, -90
        const g = grid([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 4, 3);
        expect(g.interpolate(0, 90)).toBe(0);
        expect(g.interpolate(45, 90)).toBe(0.5);
        expect(g.interpolate(315, 0)).toBe(5.5);  // between 270° (7) and wrapped 0° (4)
        expect(g.interpolate(-45, 0)).toBe(5.5);
        expect(g.date.toISOString()).toBe("2026-11-20T21:00:00.000Z");
        expect(g.source).toBe("GFS / NCEP / US National Weather Service");
    });
    it("returns null where data is missing", () => {
        const g = grid([0, null, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 4, 3);
        expect(g.interpolate(45, 90)).toBeNull();
    });
    it("treats NaN from binary layers as missing data", () => {
        const g = grid(Float32Array.from([0, NaN, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 4, 3);
        expect(g.interpolate(45, 90)).toBeNull();
        expect(g.interpolate(180, 0)).toBe(6);
    });
    it("lookupOscar finds the closest earlier file", () => {
        const catalog = ["20140101-a.json", "20140106-a.json", "20140112-a.json"];
        expect(lookupOscar(catalog, "current")).toBe("20140112-a.json");
        expect(lookupOscar(catalog, "2014/01/08")).toBe("20140106-a.json");
        expect(lookupOscar(catalog, "2014/01/06", -1)).toBe("20140101-a.json");
    });
    it("builds wind + overlay products with the expected data paths", () => {
        const [wind, temp] = productsFor({date: "2026/11/20", hour: "2100", param: "wind", surface: "isobaric",
            level: "850hPa", overlayType: "temp"});
        expect(wind.paths).toEqual(["/data/weather/2026/11/20/2100-wind-isobaric-850hPa-gfs-1.0.bin"]);
        expect(temp.paths).toEqual(["/data/weather/2026/11/20/2100-temp-isobaric-850hPa-gfs-1.0.bin"]);
        expect(overlayTypes.has("mean_sea_level_pressure")).toBe(true);
    });
});
