/**
 * micro - a grab bag of somewhat useful utility functions and other stuff that requires unit testing
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
import { Emitter } from "./events.js";

const τ = 2 * Math.PI;
const H = 0.0000360;  // 0.0000360°φ ~= 4m
const DEFAULT_CONFIG = "current/wind/surface/level/orthographic";
const TOPOLOGY = isMobile() ? "/data/earth-topo-mobile.json" : "/data/earth-topo.json";

/** @returns {Boolean} true if the specified value is truthy. */
export function isTruthy(x) {
    return !!x;
}

/** @returns {Boolean} true if the specified value is not null and not undefined. */
export function isValue(x) {
    return x !== null && x !== undefined;
}

/** @returns {Object} the first argument if not null and not undefined, otherwise the second argument. */
export function coalesce(a, b) {
    return isValue(a) ? a : b;
}

/**
 * @returns {Number} returns remainder of floored division, i.e., floor(a / n). Useful for consistent modulo
 *          of negative numbers. See http://en.wikipedia.org/wiki/Modulo_operation.
 */
export function floorMod(a, n) {
    const f = a - n * Math.floor(a / n);
    // HACK: when a is extremely close to an n transition, f can be equal to n. This is bad because f must be
    //       within range [0, n). Check for this corner case.
    return f === n ? 0 : f;
}

/** @returns {Number} distance between two points having the form [x, y]. */
export function distance(a, b) {
    const Δx = b[0] - a[0];
    const Δy = b[1] - a[1];
    return Math.sqrt(Δx * Δx + Δy * Δy);
}

/** @returns {Number} the value x clamped to the range [low, high]. */
export function clamp(x, low, high) {
    return Math.max(low, Math.min(x, high));
}

/**
 * @returns {number} the fraction of the bounds [low, high] covered by the value x, after clamping x to the
 *          bounds. For example, given bounds=[10, 20], this method returns 1 for x>=20, 0.5 for x=15 and 0
 *          for x<=10.
 */
export function proportion(x, low, high) {
    return (clamp(x, low, high) - low) / (high - low);
}

/** @returns {number} the value p within the range [0, 1], scaled to the range [low, high]. */
export function spread(p, low, high) {
    return p * (high - low) + low;
}

/** Pad number with leading zeros. Does not support fractional or negative numbers. */
export function zeroPad(n, width) {
    return n.toString().padStart(width, "0");
}

/** @returns {String} the specified string with the first letter capitalized. */
export function capitalize(s) {
    return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.substring(1);
}

/** @returns {Boolean} true if agent is probably firefox. Don't really care if this is accurate. */
export function isFF() {
    return typeof navigator !== "undefined" && (/firefox/i).test(navigator.userAgent);
}

/** @returns {Boolean} true if agent is probably a mobile device. Don't really care if this is accurate. */
export function isMobile() {
    return typeof navigator !== "undefined" &&
        (/android|blackberry|iemobile|ipad|iphone|ipod|opera mini|webos/i).test(navigator.userAgent);
}

export function isEmbeddedInIFrame() {
    return window != window.top;
}

export function toUTCISO(date) {
    return date.getUTCFullYear() + "-" +
        zeroPad(date.getUTCMonth() + 1, 2) + "-" +
        zeroPad(date.getUTCDate(), 2) + " " +
        zeroPad(date.getUTCHours(), 2) + ":00";
}

export function toLocalISO(date) {
    return date.getFullYear() + "-" +
        zeroPad(date.getMonth() + 1, 2) + "-" +
        zeroPad(date.getDate(), 2) + " " +
        zeroPad(date.getHours(), 2) + ":00";
}

/**
 * @returns {String} the string yyyyfmmfdd as yyyytmmtdd, where f and t are the "from" and "to" delimiters. Either
 *          delimiter may be the empty string.
 */
export function ymdRedelimit(ymd, fromDelimiter, toDelimiter) {
    if (!fromDelimiter) {
        return ymd.substring(0, 4) + toDelimiter + ymd.substring(4, 6) + toDelimiter + ymd.substring(6, 8);
    }
    const parts = ymd.substring(0, 10).split(fromDelimiter);
    return [parts[0], parts[1], parts[2]].join(toDelimiter);
}

/**
 * @returns {String} the UTC year, month, and day of the specified date in yyyyfmmfdd format, where f is the
 *          delimiter (and may be the empty string).
 */
export function dateToUTCymd(date, delimiter) {
    return ymdRedelimit(date.toISOString(), "-", delimiter || "");
}

export function dateToConfig(date) {
    return {date: dateToUTCymd(date, "/"), hour: zeroPad(date.getUTCHours(), 2) + "00"};
}

/** @returns {Object} an object to perform logging. */
export function log() {
    const format = o => o && o.stack ? o + "\n" + o.stack : o;
    return {
        debug:   s => console.log(format(s)),
        info:    s => console.info(format(s)),
        error:   e => console.error(format(e)),
        time:    s => console.time(format(s)),
        timeEnd: s => console.timeEnd(format(s))
    };
}

/** @returns {width: (Number), height: (Number)} an object that describes the size of the browser's current view. */
export function view() {
    const d = document.documentElement;
    return {width: window.innerWidth || d.clientWidth, height: window.innerHeight || d.clientHeight};
}

/** Removes all children of the specified DOM element. */
export function removeChildren(element) {
    element.replaceChildren();
}

/** @returns {Object} clears and returns the specified Canvas element's 2d context. */
export function clearCanvas(canvas) {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

function colorInterpolator(start, end) {
    const r = start[0], g = start[1], b = start[2];
    const Δr = end[0] - r, Δg = end[1] - g, Δb = end[2] - b;
    return (i, a) => [Math.floor(r + i * Δr), Math.floor(g + i * Δg), Math.floor(b + i * Δb), a];
}

/**
 * Produces a color style in a rainbow-like trefoil color space. Not quite HSV, but produces a nice
 * spectrum. See http://krazydad.com/tutorials/makecolors.php.
 *
 * @param hue the hue rotation in the range [0, 1]
 * @param a the alpha value in the range [0, 255]
 * @returns {Array} [r, g, b, a]
 */
export function sinebowColor(hue, a) {
    // Map hue [0, 1] to radians [0, 5/6τ]. Don't allow a full rotation because that keeps hue == 0 and
    // hue == 1 from mapping to the same color.
    let rad = hue * τ * 5 / 6;
    rad *= 0.75;  // increase frequency to 2/3 cycle per rad

    const s = Math.sin(rad);
    const c = Math.cos(rad);
    const r = Math.floor(Math.max(0, -c) * 255);
    const g = Math.floor(Math.max(s, 0) * 255);
    const b = Math.floor(Math.max(c, 0, -s) * 255);
    return [r, g, b, a];
}

const BOUNDARY = 0.45;
const fadeToWhite = colorInterpolator(sinebowColor(1.0, 0), [255, 255, 255]);

/**
 * Interpolates a sinebow color where 0 <= i <= j, then fades to white where j < i <= 1.
 *
 * @param i number in the range [0, 1]
 * @param a alpha value in range [0, 255]
 * @returns {Array} [r, g, b, a]
 */
export function extendedSinebowColor(i, a) {
    return i <= BOUNDARY ?
        sinebowColor(i / BOUNDARY, a) :
        fadeToWhite((i - BOUNDARY) / (1 - BOUNDARY), a);
}

function asColorStyle(r, g, b, a) {
    return "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
}

/**
 * @returns {Array} of wind colors and a method, indexFor, that maps wind magnitude to an index on the color scale.
 */
export function windIntensityColorScale(step, maxWind) {
    const result = [];
    for (let j = 85; j <= 255; j += step) {
        result.push(asColorStyle(j, j, j, 1.0));
    }
    result.indexFor = m => Math.floor(Math.min(m, maxWind) / maxWind * (result.length - 1));
    return result;
}

/**
 * Creates a color scale composed of the specified segments. Segments is an array of two-element arrays of the
 * form [value, color], where value is the point along the scale and color is the [r, g, b] color at that point.
 *
 * @param segments array of color segments
 * @returns {Function} a function(point, alpha) that returns the color [r, g, b, alpha] for the given point.
 */
export function segmentedColorScale(segments) {
    const points = [], interpolators = [], ranges = [];
    for (let i = 0; i < segments.length - 1; i++) {
        points.push(segments[i + 1][0]);
        interpolators.push(colorInterpolator(segments[i][1], segments[i + 1][1]));
        ranges.push([segments[i][0], segments[i + 1][0]]);
    }

    return function(point, alpha) {
        let i;
        for (i = 0; i < points.length - 1; i++) {
            if (point <= points[i]) {
                break;
            }
        }
        const range = ranges[i];
        return interpolators[i](proportion(point, range[0], range[1]), alpha);
    };
}

/** Returns a human readable string for the provided coordinates. */
export function formatCoordinates(λ, φ) {
    return Math.abs(φ).toFixed(2) + "° " + (φ >= 0 ? "N" : "S") + ", " +
        Math.abs(λ).toFixed(2) + "° " + (λ >= 0 ? "E" : "W");
}

/** Returns a human readable string for the provided scalar in the given units. */
export function formatScalar(value, units) {
    return units.conversion(value).toFixed(units.precision);
}

/**
 * Returns a human readable string for the provided rectangular wind vector in the given units.
 * See http://mst.nerc.ac.uk/wind_vect_convs.html.
 */
export function formatVector(wind, units) {
    const d = Math.atan2(-wind[0], -wind[1]) / τ * 360;  // calculate into-the-wind cardinal degrees
    const wd = Math.round((d + 360) % 360 / 5) * 5;  // shift [-180, 180] to [0, 360], and round to nearest 5.
    return wd.toFixed(0) + "° @ " + formatScalar(wind[2], units);
}

/**
 * Returns a promise for a JSON resource (URL) fetched via XHR. If the load fails, the promise rejects with an
 * object describing the reason: {status: http-status-code, message: http-status-text, resource:}.
 */
export async function loadJson(resource) {
    let response;
    try {
        response = await fetch(resource);
    } catch (e) {
        throw {status: -1, message: "Cannot load resource: " + resource, resource};
    }
    if (!response.ok) {
        throw {status: response.status, message: response.statusText, resource};
    }
    return response.json();
}

/**
 * Parses the compact binary layer format written by scripts/fetch_gfs.py:
 *
 *     "EGB1" | uint32 LE n | n bytes of UTF-8 JSON (array of record headers) | padding to 4 bytes |
 *     for each record: nx * ny float32 LE values (NaN where there is no data)
 *
 * @returns {Array} records in the same shape as the JSON format: [{header, data: Float32Array}, ...]
 */
export function parseBinaryLayer(buffer) {
    const bytes = new Uint8Array(buffer);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== "EGB1") {
        throw new Error("not an EGB1 layer");
    }
    const headerLength = new DataView(buffer).getUint32(4, true);
    const headers = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)));
    let offset = 8 + headerLength;
    offset += (4 - offset % 4) % 4;
    return headers.map(header => {
        const size = header.nx * header.ny;
        const data = new Float32Array(buffer, offset, size);
        offset += size * 4;
        return {header, data};
    });
}

/**
 * Returns a promise for a weather layer: binary (.bin) or JSON. Rejects like loadJson.
 */
export async function loadData(resource) {
    if (!resource.endsWith(".bin")) {
        return loadJson(resource);
    }
    let response;
    try {
        response = await fetch(resource);
    } catch (e) {
        throw {status: -1, message: "Cannot load resource: " + resource, resource};
    }
    if (!response.ok) {
        throw {status: response.status, message: response.statusText, resource};
    }
    return parseBinaryLayer(await response.arrayBuffer());
}

/**
 * Returns the distortion introduced by the specified projection at the given point.
 *
 * This method uses finite difference estimates to calculate warping by adding a very small amount (h) to
 * both the longitude and latitude to create two lines. These lines are then projected to pixel space, where
 * they become diagonals of triangles that represent how much the projection warps longitude and latitude at
 * that location.
 *
 * See:
 *     Map Projections: A Working Manual, Snyder, John P: pubs.er.usgs.gov/publication/pp1395
 *     gis.stackexchange.com/questions/5068/how-to-create-an-accurate-tissot-indicatrix
 *     www.jasondavies.com/maps/tissot
 *
 * @returns {Array} array of scaled derivatives [dx/dλ, dy/dλ, dx/dφ, dy/dφ]
 */
export function distortion(projection, λ, φ, x, y) {
    const hλ = λ < 0 ? H : -H;
    const hφ = φ < 0 ? H : -H;
    const pλ = projection([λ + hλ, φ]);
    const pφ = projection([λ, φ + hφ]);

    // Meridian scale factor (see Snyder, equation 4-3), where R = 1. This handles issue where length of 1° λ
    // changes depending on φ. Without this, there is a pinching effect at the poles.
    const k = Math.cos(φ / 360 * τ);

    return [
        (pλ[0] - x) / hλ / k,
        (pλ[1] - y) / hλ / k,
        (pφ[0] - x) / hφ,
        (pφ[1] - y) / hφ
    ];
}

/** @returns {Function} a debounced version of fn that runs after `wait` ms of silence. */
export function debounce(fn, wait) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

/** @returns {Function} a version of fn that runs at most once per `wait` ms, on the trailing edge. */
export function throttle(fn, wait) {
    let timer = null, lastArgs = null, lastThis = null;
    return function(...args) {
        lastArgs = args;
        lastThis = this;
        if (timer === null) {
            timer = setTimeout(() => {
                timer = null;
                fn.apply(lastThis, lastArgs);
            }, wait);
        }
    };
}

/** @returns {Number} a random integer in the inclusive range [low, high]. */
export function randomInt(low, high) {
    return low + Math.floor(Math.random() * (high - low + 1));
}

/**
 * Returns a new agent. An agent executes tasks and stores the result of the most recently completed task.
 *
 * A task is a value or promise, or a function that returns a value or promise. After submitting a task to
 * an agent using the submit() method, the task is evaluated and its result becomes the agent's value,
 * replacing the previous value. If a task is submitted to an agent while an earlier task is still in
 * progress, the earlier task is cancelled and its result ignored.
 *
 * Agents are event emitters. When a submitted task is accepted for invocation, a "submit" event is emitted.
 * When a task finishes and the agent's value changes, an "update" event is emitted with (value, agent). If a task
 * fails by throwing or rejecting, a "reject" event (err, agent) is emitted. If an event handler throws, a "fail"
 * event (err, agent) is emitted.
 *
 * Within the task callback, "this" is the agent, so a task can check this.cancel.requested to abort early.
 *
 * @param [initial] initial value of the agent, if any
 */
export function newAgent(initial) {

    function cancelFactory() {
        return function cancel() {
            cancel.requested = true;
            return agent;
        };
    }

    function runTask(cancel, task, args) {

        function run(resolvedArgs) {
            return cancel.requested ? null : typeof task === "function" ? task.apply(agent, resolvedArgs) : task;
        }

        function accept(result) {
            if (!cancel.requested) {
                value = result;
                agent.trigger("update", result, agent);
            }
        }

        function reject(err) {
            if (!cancel.requested) {  // ANNOYANCE: when cancelled, this task's error is silently suppressed
                agent.trigger("reject", err, agent);
            }
        }

        function fail(err) {
            agent.trigger("fail", err, agent);
        }

        try {
            Promise.all(args).then(run).then(accept, reject).catch(fail);
            agent.trigger("submit", agent);
        } catch (err) {
            fail(err);
        }
    }

    let value = initial;
    // ignore multiple simultaneous submissions--reduces noise
    const runTask_debounced = debounce(runTask, 0);
    const agent = new Emitter();

    /** @returns {Object} this agent's current value. */
    agent.value = () => value;

    /** Cancels this agent's most recently submitted task. */
    agent.cancel = cancelFactory();

    /**
     * Submit a new task and arguments to invoke the task with. The task may return a promise for
     * asynchronous tasks, and all arguments may be either values or promises. The previously submitted
     * task, if any, is immediately cancelled.
     */
    agent.submit = function(task, ...args) {
        this.cancel();
        runTask_debounced(this.cancel = cancelFactory(), task, args);
        return this;
    };

    return agent;
}

/**
 * Parses a URL hash fragment:
 *
 * example: "2013/11/14/0900Z/wind/isobaric/1000hPa/orthographic=26.50,-153.00,1430/overlay=off"
 * output: {date: "2013/11/14", hour: "0900", param: "wind", surface: "isobaric", level: "1000hPa",
 *          projection: "orthographic", orientation: "26.50,-153.00,1430", overlayType: "off"}
 *
 * grammar:
 *     hash   := ( "current" | yyyy / mm / dd / hhhh "Z" ) / param / surface / level [ / option [ / option ... ] ]
 *     option := type [ "=" number [ "," number [ ... ] ] ]
 */
export function parse(hash, projectionNames, overlayTypes) {
    let option, result = {};
    //             1        2        3          4          5            6      7      8    9
    const tokens = /^(current|(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{3,4})Z)\/(\w+)\/(\w+)\/(\w+)([\/].+)?/.exec(hash);
    if (tokens) {
        const date = tokens[1] === "current" ?
            "current" :
            tokens[2] + "/" + zeroPad(tokens[3], 2) + "/" + zeroPad(tokens[4], 2);
        const hour = isValue(tokens[5]) ? zeroPad(tokens[5], 4) : "";
        result = {
            date,                        // "current" or "yyyy/mm/dd"
            hour,                        // "hhhh" or ""
            param: tokens[6],            // non-empty alphanumeric _
            surface: tokens[7],          // non-empty alphanumeric _
            level: tokens[8],            // non-empty alphanumeric _
            projection: "orthographic",
            orientation: "",
            topology: TOPOLOGY,
            overlayType: "default",
            showGridPoints: false
        };
        coalesce(tokens[9], "").split("/").forEach(segment => {
            if ((option = /^(\w+)(=([\d\-.,]*))?$/.exec(segment))) {
                if (projectionNames.has(option[1])) {
                    result.projection = option[1];                 // non-empty alphanumeric _
                    result.orientation = coalesce(option[3], "");  // comma delimited string of numbers, or ""
                }
            }
            else if ((option = /^overlay=(\w+)$/.exec(segment))) {
                if (overlayTypes.has(option[1]) || option[1] === "default") {
                    result.overlayType = option[1];
                }
            }
            else if ((option = /^grid=(\w+)$/.exec(segment))) {
                if (option[1] === "on") {
                    result.showGridPoints = true;
                }
            }
        });
    }
    return result;
}

/**
 * A model that persists its attributes as a human readable URL hash fragment. Changes fire "change:<attr>"
 * events (model, value, options) for each changed attribute, followed by one "change" event (model, options).
 * This replaces the Backbone.Model used by the original implementation.
 */
export class Configuration extends Emitter {
    constructor(projectionNames, overlayTypes) {
        super();
        this.attributes = {};
        this._changed = {};
        this._ignoreNextHashChangeEvent = false;
        this._projectionNames = projectionNames;
        this._overlayTypes = overlayTypes;
    }

    get(key) {
        return this.attributes[key];
    }

    /** @returns {Object} the attributes that changed during the most recent set(). */
    changedAttributes() {
        return this._changed;
    }

    set(attrs, options = {}) {
        const changed = {};
        for (const [key, value] of Object.entries(attrs)) {
            if (this.attributes[key] !== value) {
                changed[key] = value;
            }
        }
        Object.assign(this.attributes, attrs);
        this._changed = changed;
        const keys = Object.keys(changed);
        for (const key of keys) {
            this.trigger("change:" + key, this, changed[key], options);
        }
        if (keys.length > 0) {
            this.trigger("change", this, options);
        }
        return this;
    }

    /** Sets the attributes, then persists the configuration to the hash fragment. */
    save(attrs, options = {}) {
        this.set(attrs, options);
        // Setting the hash fires a hashchange event during the next event loop turn. Ignore it.
        const hash = this.toHash();
        if (window.location.hash.substring(1) !== hash) {
            this._ignoreNextHashChangeEvent = true;
            window.location.hash = hash;
        }
        return this;
    }

    /** Loads the configuration from the hash fragment. "hashchange" events must pass {trigger: "hashchange"}. */
    fetch(options = {}) {
        if (options.trigger === "hashchange" && this._ignoreNextHashChangeEvent) {
            this._ignoreNextHashChangeEvent = false;
            return this;
        }
        return this.set(parse(
            window.location.hash.substring(1) || DEFAULT_CONFIG,
            this._projectionNames,
            this._overlayTypes), options);
    }

    /** @returns {String} this configuration converted to a hash fragment. */
    toHash() {
        const attr = this.attributes;
        const dir = attr.date === "current" ? "current" : attr.date + "/" + attr.hour + "Z";
        const proj = [attr.projection, attr.orientation].filter(isTruthy).join("=");
        const ol = !isValue(attr.overlayType) || attr.overlayType === "default" ? "" : "overlay=" + attr.overlayType;
        const grid = attr.showGridPoints ? "grid=on" : "";
        return [dir, attr.param, attr.surface, attr.level, ol, proj, grid].filter(isTruthy).join("/");
    }
}

export function buildConfiguration(projectionNames, overlayTypes) {
    return new Configuration(projectionNames, overlayTypes);
}
