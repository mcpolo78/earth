/**
 * products - defines the behavior of weather data grids, including grid construction, interpolation, and color scales.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
import * as µ from "./micro.js";

const WEATHER_PATH = "/data/weather";
const OSCAR_PATH = "/data/oscar";

let oscarCatalog = null;
const catalogs = {
    // The OSCAR catalog is an array of file names, sorted and prefixed with yyyyMMdd. Last item is the
    // most recent. For example: [ 20140101-abc.json, 20140106-abc.json, 20140112-abc.json, ... ]
    get oscar() {
        return oscarCatalog ??= µ.loadJson([OSCAR_PATH, "catalog.json"].join("/"));
    }
};

function buildProduct(overrides) {
    return Object.assign({
        description: "",
        paths: [],
        date: null,
        navigate(step) {
            return gfsStep(this.date, step);
        },
        async load(cancel) {
            const files = await Promise.all(this.paths.map(µ.loadData));
            if (cancel.requested) return null;
            this.files = files;  // kept so the overlay worker can build its own copy of the grid
            return Object.assign(this, buildGrid(this.builder(...files)));
        }
    }, overrides);
}

function gfsPath(attr, type, surface, level, resolution) {
    const dir = attr.date, stamp = dir === "current" ? "current" : attr.hour;
    const file = [stamp, type, surface, level, "gfs", resolution].filter(µ.isValue).join("-") + ".bin";
    return [WEATHER_PATH, dir, file].join("/");
}

function gfs1p0degPath(attr, type, surface, level) {
    return gfsPath(attr, type, surface, level, "1.0");
}

/** GFS-Wave layers, thinned to 0.5° by scripts/fetch_gfs.py. */
function gfsWave0p5degPath(attr, type) {
    return gfsPath(attr, type, "surface", "level", "0.5");
}

/** GEFS-Aerosols layers, thinned to 0.5° by scripts/fetch_gfs.py. */
function gefsAerosol0p5degPath(attr, type) {
    return gfsPath(attr, type, null, null, "0.5");
}

/** An air quality overlay from GEFS-Aerosols: a scalar layer with the given scale. */
function aerosolFactory(type, name, units, scale) {
    return {
        matches: matches({param: "wind", overlayType: type}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type,
                description: localize({name, qualifier: ""}),
                paths: [gefsAerosol0p5degPath(attr, type)],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units,
                scale
            });
        }
    };
}

// Colors follow the usual air quality index bands: good, moderate, unhealthy for sensitive groups, unhealthy,
// very unhealthy, hazardous.
const PM_UNITS = [{label: "µg/m³", conversion: x => x, precision: 0}];
const AQI_COLORS = [[40, 80, 140], [50, 170, 120], [230, 220, 60], [245, 140, 40], [220, 40, 50], [140, 40, 150], [110, 20, 40]];

function aqiScale(thresholds) {
    return {
        bounds: [0, thresholds[thresholds.length - 1]],
        gradient: µ.segmentedColorScale(thresholds.map((t, i) => [t, AQI_COLORS[i]]))
    };
}

function gfsDate(attr) {
    if (attr.date === "current") {
        // Construct the date from the current time, rounding down to the nearest three-hour block.
        const now = new Date(Date.now()), hour = Math.floor(now.getUTCHours() / 3);
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
    }
    const parts = attr.date.split("/");
    return new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], +attr.hour.substring(0, 2)));
}

/**
 * Returns a date for the chronologically next or previous GFS data layer. How far forward or backward in time
 * to jump is determined by the step. Steps of ±1 move in 3-hour jumps, and steps of ±10 move in 24-hour jumps.
 */
function gfsStep(date, step) {
    const offset = (step > 1 ? 8 : step < -1 ? -8 : step) * 3, adjusted = new Date(date);
    adjusted.setHours(adjusted.getHours() + offset);
    return adjusted;
}

function netcdfHeader(time, lat, lon, center) {
    return {
        lo1: lon.sequence.start,
        la1: lat.sequence.start,
        dx: lon.sequence.delta,
        dy: -lat.sequence.delta,
        nx: lon.sequence.size,
        ny: lat.sequence.size,
        refTime: time.data[0],
        forecastTime: 0,
        centerName: center
    };
}

function describeSurface(attr) {
    return attr.surface === "surface" ? "Surface" : µ.capitalize(attr.level);
}

function describeSurfaceJa(attr) {
    return attr.surface === "surface" ? "地上" : µ.capitalize(attr.level);
}

/**
 * Returns a function f(langCode) that, given table:
 *     {foo: {en: "A", ja: "あ"}, bar: {en: "I", ja: "い"}}
 * will return {foo: "A", bar: "I"} when called with "en", or {foo: "あ", bar: "い"} with "ja".
 */
function localize(table) {
    return function(langCode) {
        const result = {};
        for (const [key, value] of Object.entries(table)) {
            result[key] = value[langCode] || value.en || value;
        }
        return result;
    };
}

function matches(pattern) {
    return attr => Object.entries(pattern).every(([k, v]) => attr[k] === v);
}

/**
 * Builder for a scalar record. Accepts either the grib2json format ([{header, data}]) produced by
 * scripts/fetch_gfs.py, or the legacy NetCDF-as-JSON format ({variables: {...}}) with the given variable names.
 */
function scalarBuilder(...netcdfVariableNames) {
    return function(file) {
        if (file.variables) {
            const vars = file.variables;
            const variable = netcdfVariableNames.map(name => vars[name]).find(µ.isValue);
            const data = variable.data;
            return {
                header: netcdfHeader(vars.time, vars.lat, vars.lon, file.Originating_or_generating_Center),
                interpolate: bilinearInterpolateScalar,
                data: i => data[i]
            };
        }
        const record = file[0], data = record.data;
        return {
            header: record.header,
            interpolate: bilinearInterpolateScalar,
            data: i => data[i]
        };
    };
}

const FACTORIES = {

    "wind": {
        matches: matches({param: "wind"}),
        create(attr) {
            return buildProduct({
                field: "vector",
                type: "wind",
                description: localize({
                    name: {en: "Wind", ja: "風速"},
                    qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                }),
                paths: [gfs1p0degPath(attr, "wind", attr.surface, attr.level)],
                date: gfsDate(attr),
                builder(file) {
                    const uData = file[0].data, vData = file[1].data;
                    return {
                        header: file[0].header,
                        interpolate: bilinearInterpolateVector,
                        data: i => [uData[i], vData[i]]
                    };
                },
                units: [
                    {label: "km/h", conversion: x => x * 3.6,      precision: 0},
                    {label: "m/s",  conversion: x => x,            precision: 1},
                    {label: "kn",   conversion: x => x * 1.943844, precision: 0},
                    {label: "mph",  conversion: x => x * 2.236936, precision: 0}
                ],
                scale: {
                    bounds: [0, 100],
                    gradient: (v, a) => µ.extendedSinebowColor(Math.min(v, 100) / 100, a)
                },
                particles: {velocityScale: 1 / 60000, maxIntensity: 17}
            });
        }
    },

    "temp": {
        matches: matches({param: "wind", overlayType: "temp"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "temp",
                description: localize({
                    name: {en: "Temp", ja: "気温"},
                    qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                }),
                paths: [gfs1p0degPath(attr, "temp", attr.surface, attr.level)],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units: [
                    {label: "°C", conversion: x => x - 273.15,       precision: 1},
                    {label: "°F", conversion: x => x * 9 / 5 - 459.67, precision: 1},
                    {label: "K",  conversion: x => x,                precision: 1}
                ],
                scale: {
                    bounds: [193, 328],
                    gradient: µ.segmentedColorScale([
                        [193,     [37, 4, 42]],
                        [206,     [41, 10, 130]],
                        [219,     [81, 40, 40]],
                        [233.15,  [192, 37, 149]],  // -40 C/F
                        [255.372, [70, 215, 215]],  // 0 F
                        [273.15,  [21, 84, 187]],   // 0 C
                        [275.15,  [24, 132, 14]],   // just above 0 C
                        [291,     [247, 251, 59]],
                        [298,     [235, 167, 21]],
                        [311,     [230, 71, 39]],
                        [328,     [88, 27, 67]]
                    ])
                }
            });
        }
    },

    "relative_humidity": {
        matches: matches({param: "wind", overlayType: "relative_humidity"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "relative_humidity",
                description: localize({
                    name: {en: "Relative Humidity", ja: "相対湿度"},
                    qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                }),
                paths: [gfs1p0degPath(attr, "relative_humidity", attr.surface, attr.level)],
                date: gfsDate(attr),
                builder: scalarBuilder("Relative_humidity_isobaric", "Relative_humidity_height_above_ground"),
                units: [
                    {label: "%", conversion: x => x, precision: 0}
                ],
                scale: {
                    bounds: [0, 100],
                    gradient: (v, a) => µ.sinebowColor(Math.min(v, 100) / 100, a)
                }
            });
        }
    },

    "air_density": {
        matches: matches({param: "wind", overlayType: "air_density"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "air_density",
                description: localize({
                    name: {en: "Air Density", ja: "空気密度"},
                    qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                }),
                paths: [gfs1p0degPath(attr, "air_density", attr.surface, attr.level)],
                date: gfsDate(attr),
                builder: scalarBuilder("air_density"),
                units: [
                    {label: "kg/m³", conversion: x => x, precision: 2}
                ],
                scale: {
                    bounds: [0, 1.5],
                    gradient: (v, a) => µ.sinebowColor(Math.min(v, 1.5) / 1.5, a)
                }
            });
        }
    },

    "wind_power_density": {
        matches: matches({param: "wind", overlayType: "wind_power_density"}),
        create(attr) {
            const windProduct = FACTORIES.wind.create(attr);
            const airdensProduct = FACTORIES.air_density.create(attr);
            return buildProduct({
                field: "scalar",
                type: "wind_power_density",
                description: localize({
                    name: {en: "Wind Power Density", ja: "風力エネルギー密度"},
                    qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                }),
                paths: [windProduct.paths[0], airdensProduct.paths[0]],
                date: gfsDate(attr),
                builder(windFile, airdensFile) {
                    const windBuilder = windProduct.builder(windFile);
                    const airdensBuilder = airdensProduct.builder(airdensFile);
                    const windData = windBuilder.data, windInterpolate = windBuilder.interpolate;
                    const airdensData = airdensBuilder.data, airdensInterpolate = airdensBuilder.interpolate;
                    return {
                        header: {...airdensBuilder.header},
                        interpolate(x, y, g00, g10, g01, g11) {
                            const m = windInterpolate(x, y, g00[0], g10[0], g01[0], g11[0])[2];
                            const ρ = airdensInterpolate(x, y, g00[1], g10[1], g01[1], g11[1]);
                            return 0.5 * ρ * m * m * m;
                        },
                        data: i => [windData(i), airdensData(i)]
                    };
                },
                units: [
                    {label: "kW/m²", conversion: x => x / 1000, precision: 1},
                    {label: "W/m²", conversion: x => x, precision: 0}
                ],
                scale: {
                    bounds: [0, 80000],
                    gradient: µ.segmentedColorScale([
                        [0, [15, 4, 96]],
                        [250, [30, 8, 180]],
                        [1000, [121, 102, 2]],
                        [2000, [118, 161, 66]],
                        [4000, [50, 102, 219]],
                        [8000, [19, 131, 193]],
                        [16000, [59, 204, 227]],
                        [64000, [241, 1, 45]],
                        [80000, [243, 0, 241]]
                    ])
                }
            });
        }
    },

    "total_cloud_water": {
        matches: matches({param: "wind", overlayType: "total_cloud_water"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "total_cloud_water",
                description: localize({
                    name: {en: "Total Cloud Water", ja: "雲水量"},
                    qualifier: ""
                }),
                paths: [gfs1p0degPath(attr, "total_cloud_water")],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units: [
                    {label: "kg/m²", conversion: x => x, precision: 3}
                ],
                scale: {
                    bounds: [0, 1],
                    gradient: µ.segmentedColorScale([
                        [0.0, [5, 5, 89]],
                        [0.2, [170, 170, 230]],
                        [1.0, [255, 255, 255]]
                    ])
                }
            });
        }
    },

    "total_precipitable_water": {
        matches: matches({param: "wind", overlayType: "total_precipitable_water"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "total_precipitable_water",
                description: localize({
                    name: {en: "Total Precipitable Water", ja: "可降水量"},
                    qualifier: ""
                }),
                paths: [gfs1p0degPath(attr, "total_precipitable_water")],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units: [
                    {label: "kg/m²", conversion: x => x, precision: 3}
                ],
                scale: {
                    bounds: [0, 70],
                    gradient: µ.segmentedColorScale([
                        [0, [230, 165, 30]],
                        [10, [120, 100, 95]],
                        [20, [40, 44, 92]],
                        [30, [21, 13, 193]],
                        [40, [75, 63, 235]],
                        [60, [25, 255, 255]],
                        [70, [150, 255, 255]]
                    ])
                }
            });
        }
    },

    "mean_sea_level_pressure": {
        matches: matches({param: "wind", overlayType: "mean_sea_level_pressure"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "mean_sea_level_pressure",
                description: localize({
                    name: {en: "Mean Sea Level Pressure", ja: "海面更正気圧"},
                    qualifier: ""
                }),
                paths: [gfs1p0degPath(attr, "mean_sea_level_pressure")],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units: [
                    {label: "hPa", conversion: x => x / 100, precision: 0},
                    {label: "mmHg", conversion: x => x / 133.322387415, precision: 0},
                    {label: "inHg", conversion: x => x / 3386.389, precision: 1}
                ],
                scale: {
                    bounds: [92000, 105000],
                    gradient: µ.segmentedColorScale([
                        [92000, [40, 0, 0]],
                        [95000, [187, 60, 31]],
                        [96500, [137, 32, 30]],
                        [98000, [16, 1, 43]],
                        [100500, [36, 1, 93]],
                        [101300, [241, 254, 18]],
                        [103000, [228, 246, 223]],
                        [105000, [255, 255, 255]]
                    ])
                }
            });
        }
    },

    "precipitation_rate": {
        matches: matches({param: "wind", overlayType: "precipitation_rate"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "precipitation_rate",
                description: localize({
                    name: {en: "Precipitation Rate", ja: "降水強度", fr: "Précipitations"},
                    qualifier: ""
                }),
                paths: [gfs1p0degPath(attr, "precipitation_rate")],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units: [
                    {label: "mm/h", conversion: x => x * 3600, precision: 1},
                    {label: "in/h", conversion: x => x * 3600 / 25.4, precision: 2}
                ],
                scale: {
                    // kg/m²/s; 1 mm/h = 1/3600 kg/m²/s
                    bounds: [0, 15 / 3600],
                    gradient: µ.segmentedColorScale([
                        [0,          [17, 17, 40]],
                        [0.1 / 3600, [17, 17, 40]],
                        [0.5 / 3600, [32, 96, 170]],
                        [2 / 3600,   [40, 180, 120]],
                        [5 / 3600,   [240, 220, 40]],
                        [10 / 3600,  [240, 90, 30]],
                        [15 / 3600,  [220, 30, 200]]
                    ])
                }
            });
        }
    },

    "snow_depth": {
        matches: matches({param: "wind", overlayType: "snow_depth"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "snow_depth",
                description: localize({
                    name: {en: "Snow Depth", ja: "積雪深", fr: "Épaisseur de neige"},
                    qualifier: ""
                }),
                paths: [gfs1p0degPath(attr, "snow_depth")],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units: [
                    {label: "cm", conversion: x => x * 100, precision: 0},
                    {label: "in", conversion: x => x * 39.3701, precision: 1}
                ],
                scale: {
                    bounds: [0, 2],
                    gradient: µ.segmentedColorScale([
                        [0,    [20, 20, 30]],
                        [0.01, [70, 90, 140]],
                        [0.1,  [120, 160, 220]],
                        [0.5,  [200, 220, 250]],
                        [2,    [255, 255, 255]]
                    ])
                }
            });
        }
    },

    "cape": {
        matches: matches({param: "wind", overlayType: "cape"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "cape",
                description: localize({
                    name: {en: "CAPE (thunderstorm potential)", ja: "対流有効位置エネルギー", fr: "CAPE (potentiel orageux)"},
                    qualifier: ""
                }),
                paths: [gfs1p0degPath(attr, "cape")],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units: [
                    {label: "J/kg", conversion: x => x, precision: 0}
                ],
                scale: {
                    bounds: [0, 4000],
                    gradient: µ.segmentedColorScale([
                        [0,    [10, 10, 40]],
                        [100,  [30, 60, 120]],
                        [500,  [40, 160, 90]],
                        [1000, [230, 220, 50]],
                        [2000, [240, 120, 30]],
                        [3000, [220, 30, 40]],
                        [4000, [240, 40, 240]]
                    ])
                }
            });
        }
    },

    "total_cloud_cover": {
        matches: matches({param: "wind", overlayType: "total_cloud_cover"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "total_cloud_cover",
                description: localize({
                    name: {en: "Total Cloud Cover", ja: "全雲量", fr: "Couverture nuageuse"},
                    qualifier: ""
                }),
                paths: [gfs1p0degPath(attr, "total_cloud_cover")],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units: [
                    {label: "%", conversion: x => x, precision: 0}
                ],
                scale: {
                    bounds: [0, 100],
                    gradient: µ.segmentedColorScale([
                        [0,   [8, 20, 60]],
                        [30,  [60, 80, 120]],
                        [70,  [170, 180, 200]],
                        [100, [255, 255, 255]]
                    ])
                }
            });
        }
    },

    // Air quality (GEFS-Aerosols). Surface fields, so they ignore the selected height.
    "pm2_5": aerosolFactory("pm2_5",
        {en: "PM2.5", ja: "PM2.5", fr: "PM2,5"}, PM_UNITS, aqiScale([0, 10, 25, 50, 75, 150, 250])),
    "pm10": aerosolFactory("pm10",
        {en: "PM10", ja: "PM10", fr: "PM10"}, PM_UNITS, aqiScale([0, 20, 50, 100, 150, 250, 400])),
    "aerosol_optical_depth": aerosolFactory("aerosol_optical_depth",
        {en: "Aerosol Optical Depth (550 nm)", ja: "エアロゾル光学的厚さ", fr: "Épaisseur optique des aérosols"},
        [{label: "", conversion: x => x, precision: 2}],
        {
            bounds: [0, 2],
            gradient: µ.segmentedColorScale([
                [0, [25, 30, 60]], [0.1, [40, 90, 150]], [0.3, [90, 170, 140]], [0.6, [230, 210, 90]],
                [1, [235, 130, 50]], [2, [180, 40, 60]]
            ])
        }),
    "dust_optical_depth": aerosolFactory("dust_optical_depth",
        {en: "Dust Optical Depth (550 nm)", ja: "黄砂・砂塵の光学的厚さ", fr: "Épaisseur optique des poussières"},
        [{label: "", conversion: x => x, precision: 2}],
        {
            bounds: [0, 1.5],
            gradient: µ.segmentedColorScale([
                [0, [30, 30, 40]], [0.02, [80, 65, 45]], [0.1, [170, 125, 60]], [0.4, [225, 175, 85]],
                [1, [245, 215, 140]], [1.5, [255, 245, 220]]
            ])
        }),

    "currents": {
        matches: matches({param: "ocean", surface: "surface", level: "currents"}),
        async create(attr) {
            const catalog = await catalogs.oscar;
            return buildProduct({
                field: "vector",
                type: "currents",
                description: localize({
                    name: {en: "Ocean Currents", ja: "海流"},
                    qualifier: {en: " @ Surface", ja: " @ 地上"}
                }),
                paths: [oscar0p33Path(catalog, attr)],
                date: oscarDate(catalog, attr),
                navigate(step) {
                    return oscarStep(catalog, this.date, step);
                },
                builder(file) {
                    const uData = file[0].data, vData = file[1].data;
                    return {
                        header: file[0].header,
                        interpolate: bilinearInterpolateVector,
                        data(i) {
                            const u = uData[i], v = vData[i];
                            return µ.isValue(u) && µ.isValue(v) ? [u, v] : null;
                        }
                    };
                },
                units: [
                    {label: "m/s",  conversion: x => x,            precision: 2},
                    {label: "km/h", conversion: x => x * 3.6,      precision: 1},
                    {label: "kn",   conversion: x => x * 1.943844, precision: 1},
                    {label: "mph",  conversion: x => x * 2.236936, precision: 1}
                ],
                scale: {
                    bounds: [0, 1.5],
                    gradient: µ.segmentedColorScale([
                        [0, [10, 25, 68]],
                        [0.15, [10, 25, 250]],
                        [0.4, [24, 255, 93]],
                        [0.65, [255, 233, 102]],
                        [1.0, [255, 233, 15]],
                        [1.5, [255, 15, 15]]
                    ])
                },
                particles: {velocityScale: 1 / 4400, maxIntensity: 0.7}
            });
        }
    },

    "waves": {
        matches: matches({param: "ocean", level: "waves"}),
        create(attr) {
            return buildProduct({
                field: "vector",
                type: "waves",
                description: localize({
                    name: {en: "Wave Height", ja: "有義波高", fr: "Hauteur des vagues"},
                    qualifier: {en: " (dominant direction)", ja: "（卓越波向）", fr: " (direction dominante)"}
                }),
                paths: [gfsWave0p5degPath(attr, "waves")],
                date: gfsDate(attr),
                builder(file) {
                    const uData = file[0].data, vData = file[1].data;
                    return {
                        header: file[0].header,
                        interpolate: bilinearInterpolateVector,
                        data(i) {
                            const u = uData[i], v = vData[i];
                            return Number.isNaN(u) || Number.isNaN(v) ? null : [u, v];
                        }
                    };
                },
                units: [
                    {label: "m",  conversion: x => x,            precision: 1},
                    {label: "ft", conversion: x => x * 3.280839, precision: 1}
                ],
                scale: {
                    bounds: [0, 12],
                    gradient: µ.segmentedColorScale([
                        [0,   [8, 24, 60]],
                        [0.5, [20, 60, 140]],
                        [1.5, [30, 130, 200]],
                        [2.5, [40, 200, 170]],
                        [4,   [210, 230, 80]],
                        [6,   [250, 150, 40]],
                        [8,   [230, 50, 50]],
                        [12,  [200, 40, 200]]
                    ])
                },
                // Particles show where the dominant waves are heading, faster where they are higher.
                particles: {velocityScale: 1 / 9000, maxIntensity: 6}
            });
        }
    },

    "wave_period": {
        matches: matches({param: "ocean", level: "waves", overlayType: "wave_period"}),
        create(attr) {
            return buildProduct({
                field: "scalar",
                type: "wave_period",
                description: localize({
                    name: {en: "Wave Period", ja: "ピーク周期", fr: "Période des vagues"},
                    qualifier: ""
                }),
                paths: [gfsWave0p5degPath(attr, "wave_period")],
                date: gfsDate(attr),
                builder: scalarBuilder(),
                units: [
                    {label: "s", conversion: x => x, precision: 1}
                ],
                scale: {
                    bounds: [0, 20],
                    gradient: µ.segmentedColorScale([
                        [0,  [20, 20, 50]],
                        [4,  [40, 70, 150]],
                        [8,  [40, 160, 190]],
                        [12, [120, 210, 120]],
                        [16, [240, 200, 60]],
                        [20, [240, 80, 120]]
                    ])
                }
            });
        }
    },

    "off": {
        matches: matches({overlayType: "off"}),
        create() {
            return null;
        }
    }
};

/** @returns {Number} the index at which value should be inserted into the sorted array to keep it sorted. */
function sortedIndex(array, value) {
    let low = 0, high = array.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (array[mid] < value) low = mid + 1; else high = mid;
    }
    return low;
}

/**
 * Returns the file name for the most recent OSCAR data layer to the specified date. If offset is non-zero,
 * the file name that many entries from the most recent is returned.
 *
 * @param {Array} catalog array of file names, sorted and prefixed with yyyyMMdd. Last item is most recent.
 * @param {String} date string with format yyyy/MM/dd or "current"
 * @param {Number?} offset
 * @returns {String} file name
 */
export function lookupOscar(catalog, date, offset) {
    offset = +offset || 0;
    if (date === "current") {
        return catalog[catalog.length - 1 + offset];
    }
    const prefix = µ.ymdRedelimit(date, "/", "");
    let i = sortedIndex(catalog, prefix);
    i = (catalog[i] || "").indexOf(prefix) === 0 ? i : i - 1;
    return catalog[i + offset];
}

function oscar0p33Path(catalog, attr) {
    const file = lookupOscar(catalog, attr.date);
    return file ? [OSCAR_PATH, file].join("/") : null;
}

function oscarDate(catalog, attr) {
    const file = lookupOscar(catalog, attr.date);
    const parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
    return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
}

/**
 * @returns {Date} the chronologically next or previous OSCAR data layer. A step of ±1 moves to the
 * next/previous entry in the catalog (about 5 days), and a step of ±10 moves six positions away (about 30 days).
 */
function oscarStep(catalog, date, step) {
    const file = lookupOscar(catalog, µ.dateToUTCymd(date, "/"), step > 1 ? 6 : step < -1 ? -6 : step);
    const parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
    return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
}

function dataSource(header) {
    switch (header.center || header.centerName) {
        case -3:
            return "OSCAR / Earth & Space Research";
        case 7:
        case "US National Weather Service, National Centres for Environmental Prediction (NCEP)":
            return "GFS / NCEP / US National Weather Service";
        default:
            return header.centerName;
    }
}

export function bilinearInterpolateScalar(x, y, g00, g10, g01, g11) {
    const rx = (1 - x);
    const ry = (1 - y);
    return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
}

export function bilinearInterpolateVector(x, y, g00, g10, g01, g11) {
    const rx = (1 - x);
    const ry = (1 - y);
    const a = rx * ry, b = x * ry, c = rx * y, d = x * y;
    const u = g00[0] * a + g10[0] * b + g01[0] * c + g11[0] * d;
    const v = g00[1] * a + g10[1] * b + g01[1] * c + g11[1] * d;
    return [u, v, Math.sqrt(u * u + v * v)];
}

/**
 * Builds an interpolator for the specified data in the form of JSON-ified GRIB files:
 *
 *     [ { "header": { "refTime": "2013-11-30T18:00:00.000Z", "forecastTime": 6, "nx": 360, "ny": 181,
 *                     "lo1": 0, "la1": 90, "dx": 1, "dy": 1, ... },
 *         "data": [3.42, 3.31, 3.19, ...] } ]
 */
export function buildGrid(builder) {
    const header = builder.header;
    const λ0 = header.lo1, φ0 = header.la1;  // the grid's origin (e.g., 0.0E, 90.0N)
    const Δλ = header.dx, Δφ = header.dy;    // distance between grid points (e.g., 2.5 deg lon, 2.5 deg lat)
    const ni = header.nx, nj = header.ny;    // number of grid points W-E and N-S (e.g., 144 x 73)
    const date = new Date(header.refTime);
    date.setHours(date.getHours() + header.forecastTime);

    // Scan mode 0 assumed. Longitude increases from λ0, and latitude decreases from φ0.
    // http://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_table3-4.shtml
    const grid = [];
    let p = 0;
    const isContinuous = Math.floor(ni * Δλ) >= 360;
    for (let j = 0; j < nj; j++) {
        const row = [];
        for (let i = 0; i < ni; i++, p++) {
            const value = builder.data(p);
            row[i] = Number.isNaN(value) ? null : value;  // binary layers mark missing data as NaN
        }
        if (isContinuous) {
            // For wrapped grids, duplicate first column as last column to simplify interpolation logic
            row.push(row[0]);
        }
        grid[j] = row;
    }

    function interpolate(λ, φ) {
        const i = µ.floorMod(λ - λ0, 360) / Δλ;  // calculate longitude index in wrapped range [0, 360)
        const j = (φ0 - φ) / Δφ;                 // calculate latitude index in direction +90 to -90

        const fi = Math.floor(i), ci = fi + 1;
        const fj = Math.floor(j), cj = fj + 1;

        let row;
        if ((row = grid[fj])) {
            const g00 = row[fi];
            const g10 = row[ci];
            if (µ.isValue(g00) && µ.isValue(g10) && (row = grid[cj])) {
                const g01 = row[fi];
                const g11 = row[ci];
                if (µ.isValue(g01) && µ.isValue(g11)) {
                    // All four points found, so interpolate the value.
                    return builder.interpolate(i - fi, j - fj, g00, g10, g01, g11);
                }
            }
        }
        return null;
    }

    return {
        source: dataSource(header),
        date,
        interpolate,
        forEachPoint(cb) {
            for (let j = 0; j < nj; j++) {
                const row = grid[j] || [];
                for (let i = 0; i < ni; i++) {
                    cb(µ.floorMod(180 + λ0 + i * Δλ, 360) - 180, φ0 - j * Δφ, row[i]);
                }
            }
        }
    };
}

export function productsFor(attributes) {
    const attr = {...attributes}, results = [];
    for (const factory of Object.values(FACTORIES)) {
        if (factory.matches(attr)) {
            results.push(factory.create(attr));
        }
    }
    return results.filter(µ.isValue);
}

export const overlayTypes = new Set(Object.keys(FACTORIES));
