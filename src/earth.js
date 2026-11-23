/**
 * earth - a project to visualize global air data.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
import * as d3 from "d3";
import { feature } from "topojson-client";
import * as µ from "./micro.js";
import { Emitter } from "./events.js";
import { globes } from "./globes.js";
import * as products from "./products.js";
import { createAnimator } from "./particles.js";
import { initI18n, t, locale } from "./i18n.js";

initI18n();  // before anything reads <body data-lang>

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const MIN_MOVE = 4;                         // slack before a drag operation beings (pixels)
const MOVE_END_WAIT = 300;                  // time to wait for a move operation to be considered done (millis)

const OVERLAY_ALPHA = Math.floor(0.4 * 255);  // overlay transparency (on scale [0, 255])
const OVERLAY_STEP = 2;                     // overlay resolution (pixels per data sample) when the globe is still
const OVERLAY_STEP_MOVING = 6;              // coarser overlay resolution while the globe is being moved
const PARTICLE_MULTIPLIER = 7;              // particle count scalar (completely arbitrary--this values looks nice)
const PARTICLE_REDUCTION = 0.75;            // reduce particle count to this much of normal for mobile devices

const REMAINING = "▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫";   // glyphs for remaining progress bar
const COMPLETED = "▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪";   // glyphs for completed progress bar

let view = µ.view();
const log = µ.log();

/**
 * An object to display various types of messages to the user.
 */
const report = function() {
    const s = d3.select("#status"), p = d3.select("#progress"), total = REMAINING.length;
    return {
        status(msg) {
            return s.classed("bad") ? s : s.text(msg);  // errors are sticky until reset
        },
        error(err) {
            let msg = err && err.status ? err.status + " " + err.message : err;
            switch (err && err.status) {
                case -1: msg = t("status.serverDown"); break;
                case 404: msg = t("status.noData"); break;
            }
            log.error(err);
            return s.classed("bad", true).text(msg);
        },
        reset() {
            return s.classed("bad", false).text("");
        },
        progress(amount) {  // amount of progress to report in the range [0, 1]
            if (0 <= amount && amount < 1) {
                const i = Math.ceil(amount * total);
                const bar = COMPLETED.substring(0, i) + REMAINING.substring(0, total - i);
                return p.classed("invisible", false).text(bar);
            }
            return p.classed("invisible", true).text("");  // progress complete
        }
    };
}();

function newAgent() {
    return µ.newAgent().on({"reject": report.error, "fail": report.error});
}

// Construct the page's main internal components:

const configuration =
    µ.buildConfiguration(globes, products.overlayTypes);  // holds the page's current configuration settings
const inputController = buildInputController();             // interprets drag/zoom operations
const meshAgent = newAgent();      // map data for the earth
const globeAgent = newAgent();     // the model of the globe
const gridAgent = newAgent();      // the grid of weather data
const rendererAgent = newAgent();  // the globe SVG renderer
const overlay = buildOverlayRenderer();  // color overlay, rendered in a web worker
let animator = null;               // the wind particle animator
let view3d = null;                 // the WebGL globe (src/globe3d.js), created the first time it is shown

/**
 * @returns {Array|undefined} the [x, y] position of the pointer (mouse or first touch) for a d3 event.
 */
function pointerOf(event, node) {
    return d3.pointers(event, node)[0];
}

/**
 * The input controller is an object that translates move operations (drag and/or zoom) into mutations of the
 * current globe's projection, and emits events so other page components can react to these move operations.
 *
 * D3's zoom behavior binds to the document's drag/zoom events, and the input controller interprets D3's events
 * as move operations on the globe. D3 move operations usually occur as "start" -> ("zoom")* -> "end". A simple
 * click occurs as "start" -> "end". A debouncer waits a short period of time to ensure the user has finished the
 * move operation.
 *
 * This object emits clean "moveStart" -> ("move")* -> "moveEnd" events for move operations, and "click" events
 * for normal clicks. Spurious moves emit no events.
 */
function buildInputController() {
    let globe, op = null;
    const display = d3.select("#display");

    /** @returns {Object} an object to represent the state for one move operation. */
    function newOp(startMouse, startScale) {
        return {
            type: "click",  // initially assumed to be a click operation
            startMouse,
            startScale,
            manipulator: globe.manipulator(startMouse, startScale)
        };
    }

    const zoom = d3.zoom()
        .on("start", function(event) {
            if (!globe) return;
            op = op || newOp(pointerOf(event, this), event.transform.k);  // a new operation begins
        })
        .on("zoom", function(event) {
            if (!globe) return;
            const currentMouse = pointerOf(event, this) || (op && op.startMouse);
            const currentScale = event.transform.k;
            op = op || newOp(currentMouse, 1);  // zoom may fire before start on some devices
            if (op.type === "click" || op.type === "spurious") {
                const distanceMoved = µ.distance(currentMouse, op.startMouse);
                if (currentScale === op.startScale && distanceMoved < MIN_MOVE) {
                    // to reduce annoyance, ignore op if mouse has barely moved and no zoom is occurring
                    op.type = distanceMoved > 0 ? "click" : "spurious";
                    return;
                }
                dispatch.trigger("moveStart");
                op.type = "drag";
            }
            if (currentScale !== op.startScale) {
                op.type = "zoom";  // whenever a scale change is detected, (stickily) switch to a zoom operation
            }

            // when zooming, ignore whatever the mouse is doing--really cleans up behavior on touch devices
            op.manipulator.move(op.type === "zoom" ? null : currentMouse, currentScale);
            dispatch.trigger("move");
        })
        .on("end", function() {
            if (!op) return;
            op.manipulator.end();
            if (op.type === "click") {
                dispatch.trigger("click", op.startMouse, globe.projection.invert(op.startMouse) || []);
            }
            else if (op.type !== "spurious") {
                signalEnd();
            }
            op = null;  // the drag/zoom/click operation is over
        });

    /** Sets the zoom behavior's scale without emitting zoom events. */
    function setZoomScale(k) {
        display.property("__zoom", d3.zoomIdentity.scale(k));
    }

    const signalEnd = µ.debounce(function() {
        if (!op || op.type !== "drag" && op.type !== "zoom") {
            configuration.save({orientation: globe.orientation()}, {source: "moveEnd"});
            dispatch.trigger("moveEnd");
        }
    }, MOVE_END_WAIT);  // wait for a bit to decide if user has stopped moving the globe

    display.call(zoom);
    d3.select("#show-location").on("click", function() {
        if (navigator.geolocation) {
            report.status(t("status.locating"));
            navigator.geolocation.getCurrentPosition(function(pos) {
                report.status("");
                const coord = [pos.coords.longitude, pos.coords.latitude], rotate = globe.locate(coord);
                if (rotate) {
                    globe.projection.rotate(rotate);
                    configuration.save({orientation: globe.orientation()});  // triggers reorientation
                }
                if (globe.is3D && view3d) view3d.lookAt(coord);
                dispatch.trigger("click", globe.projection(coord), coord);
            }, log.error);
        }
    });

    function reorient(model, value, options = {}) {
        if (!globe || options.source === "moveEnd") {
            // reorientation occurred because the user just finished a move operation, so globe is already
            // oriented correctly.
            return;
        }
        dispatch.trigger("moveStart");
        globe.orientation(configuration.get("orientation"), view);
        setZoomScale(globe.projection.scale());
        dispatch.trigger("moveEnd");
    }

    const dispatch = new Emitter();
    dispatch.globe = function(_) {
        if (_) {
            globe = _;
            zoom.scaleExtent(globe.scaleExtent());
            reorient();
        }
        return _ ? this : globe;
    };
    return dispatch.listenTo(configuration, "change:orientation", reorient);
}

/**
 * @param resource the GeoJSON resource's URL
 * @returns {Object} a promise for GeoJSON topology features: {boundaryLo:, boundaryHi:}
 */
async function buildMesh(resource) {
    const cancel = this.cancel;
    report.status(t("status.downloading"));
    const topo = await µ.loadJson(resource);
    if (cancel.requested) return null;
    log.time("building meshes");
    const o = topo.objects;
    const coastLo = feature(topo, µ.isMobile() ? o.coastline_tiny : o.coastline_110m);
    const coastHi = feature(topo, µ.isMobile() ? o.coastline_110m : o.coastline_50m);
    const lakesLo = feature(topo, µ.isMobile() ? o.lakes_tiny : o.lakes_110m);
    const lakesHi = feature(topo, µ.isMobile() ? o.lakes_110m : o.lakes_50m);
    log.timeEnd("building meshes");
    return {coastLo, coastHi, lakesLo, lakesHi};
}

/**
 * @param {String} projectionName the desired projection's name.
 * @returns {Object} a promise for a globe object.
 */
function buildGlobe(projectionName) {
    const builder = globes.get(projectionName);
    if (!builder) {
        return Promise.reject("Unknown projection: " + projectionName);
    }
    return builder(view);
}

// Some hacky stuff to ensure only one download can be in progress at a time.
let downloadsInProgress = 0;

async function buildGrids() {
    report.status(t("status.downloading"));
    log.time("build grids");
    // UNDONE: upon failure to load a product, the unloaded product should still be stored in the agent.
    //         this allows us to use the product for navigation and other state.
    const cancel = this.cancel;
    downloadsInProgress++;
    const attr = {...configuration.attributes};
    try {
        const loaded = await Promise.all(products.productsFor(attr)
            .map(async product => (await product).load(cancel)));
        log.timeEnd("build grids");
        return {primaryGrid: loaded[0], overlayGrid: loaded[1] || loaded[0], attr};
    } finally {
        downloadsInProgress--;
    }
}

/**
 * Modifies the configuration to navigate to the chronologically next or previous data layer.
 */
function navigate(step) {
    if (downloadsInProgress > 0) {
        log.debug("Download in progress--ignoring nav request.");
        return;
    }
    const next = gridAgent.value().primaryGrid.navigate(step);
    if (next) {
        configuration.save(µ.dateToConfig(next));
    }
}

let previousRendererDispatch = null;

function buildRenderer(mesh, globe) {
    if (!mesh || !globe) return null;

    report.status(t("status.rendering"));
    log.time("rendering map");

    const dispatch = new Emitter();
    if (previousRendererDispatch) {
        previousRendererDispatch.stopListening();
    }
    previousRendererDispatch = dispatch;

    // First clear map and foreground svg contents.
    µ.removeChildren(d3.select("#map").node());
    µ.removeChildren(d3.select("#foreground").node());
    // Create new map svg elements.
    globe.defineMap(d3.select("#map"), d3.select("#foreground"));

    const path = d3.geoPath().projection(globe.projection).pointRadius(7);
    const coastline = d3.select(".coastline");
    const lakes = d3.select(".lakes");
    d3.selectAll("path").attr("d", path);  // do an initial draw -- fixes issue with safari

    function drawLocationMark(point, coord) {
        // show the location on the map if defined
        if (!isOnGlobe(globe, point, coord)) {
            return;  // not on the map, so ignore.
        }
        {
            let mark = d3.select(".location-mark");
            if (!mark.node()) {
                mark = d3.select("#foreground").append("path").attr("class", "location-mark");
            }
            mark.datum({type: "Point", coordinates: coord}).attr("d", path);
        }
    }

    // Draw the location mark if one is currently visible.
    if (activeLocation.point && activeLocation.coord) {
        drawLocationMark(activeLocation.point, activeLocation.coord);
    }

    // Throttled draw method helps with slow devices that would get overwhelmed by too many redraw events.
    const REDRAW_WAIT = 5;  // milliseconds
    const doDraw_throttled = µ.throttle(function() {
        d3.selectAll("path").attr("d", path);
        rendererAgent.trigger("redraw");
    }, REDRAW_WAIT);

    // Attach to map rendering events on input controller.
    dispatch.listenTo(
        inputController, {
            moveStart() {
                coastline.datum(mesh.coastLo);
                lakes.datum(mesh.lakesLo);
                rendererAgent.trigger("start");
            },
            move() {
                doDraw_throttled();
            },
            moveEnd() {
                coastline.datum(mesh.coastHi);
                lakes.datum(mesh.lakesHi);
                d3.selectAll("path").attr("d", path);
                rendererAgent.trigger("render");
            },
            click: drawLocationMark
        });

    // Finally, inject the globe model into the input controller. Do it on the next event turn to ensure
    // renderer is fully set up before events start flowing.
    Promise.resolve().then(() => inputController.globe(globe));

    log.timeEnd("rendering map");
    return "ready";
}

/**
 * @returns {Boolean} true if the screen point shows the given coordinates on the map, i.e. the point is not in
 *          the empty space around the globe or on its far side.
 */
function isOnGlobe(globe, point, coord) {
    if (!globe || !point || !coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return false;
    const p = projectVisible(globe, coord);
    return !!p && Math.abs(p[0] - point[0]) <= 1 && Math.abs(p[1] - point[1]) <= 1;
}

/** @returns {Array|null} the screen position of coord, or null when the projection clips it away. */
function projectVisible(globe, coord) {
    let p = null;
    globe.projection.stream({point(x, y) { p = [x, y]; }}).point(coord[0], coord[1]);
    return p;
}

/**
 * Starts (or restarts) the particle animation for the current globe and grids. Particles live in geographic
 * coordinates, so the animation keeps running while the globe is dragged or zoomed.
 */
function startAnimation() {
    stopAnimation(true);
    const globe = globeAgent.value(), grids = gridAgent.value();
    if (!globe || !grids || !grids.primaryGrid.particles || globe.is3D) return;  // the 3D view animates itself
    let particleCount = globe.bounds(view).width * PARTICLE_MULTIPLIER;
    if (µ.isMobile()) {
        particleCount *= PARTICLE_REDUCTION;
    }
    animator = createAnimator(d3.select("#animation").node(), globe, grids.primaryGrid, {
        particleCount,
        getView: () => view
    });
    animator.globe = globe;
    animator.grids = grids;
    report.status("");
    log.debug("particle count: " + animator.particleCount);
}

function stopAnimation(alsoClearCanvas) {
    if (animator) {
        animator.stop(alsoClearCanvas);
        animator = null;
    }
    else if (alsoClearCanvas) {
        µ.clearCanvas(d3.select("#animation").node());
    }
}

/**
 * The overlay renderer sends the overlay grid's raw files to a web worker once per data change, then asks it to
 * render the current view. Only one render is in flight at a time; while it runs, newer requests replace each
 * other, so a fast drag never queues up stale work.
 */
function buildOverlayRenderer() {
    const canvas = d3.select("#overlay").node();
    const worker = new Worker(new URL("./overlay-worker.js", import.meta.url), {type: "module"});
    let version = 0, ready = false, inFlight = false, pending = null, enabled = false, nextId = 0;

    function flush() {
        if (inFlight || !ready || !pending) return;
        inFlight = true;
        worker.postMessage(pending);
        pending = null;
    }

    function draw(data) {
        if (data.width !== canvas.width || data.height !== canvas.height) return;  // view resized meanwhile
        const ctx = canvas.getContext("2d");
        ctx.putImageData(new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height), 0, 0);
        drawGridPoints(ctx, (gridAgent.value() || {}).overlayGrid, globeAgent.value());
    }

    worker.onmessage = ({data}) => {
        switch (data.type) {
            case "grid-ready":
                if (data.version === version) {
                    ready = true;
                    flush();
                }
                break;
            case "rendered":
                inFlight = false;
                if (data.version === version && enabled) draw(data);
                flush();
                break;
            case "error":
                inFlight = false;
                log.error(data.message);
                flush();
                break;
        }
    };

    return {
        /** Hands the overlay grid of a newly loaded set of grids to the worker. */
        setGrids(grids) {
            version++;
            ready = false;
            pending = null;
            const index = grids.overlayGrid === grids.primaryGrid ? 0 : 1;
            worker.postMessage({type: "grid", version, attr: grids.attr, index, files: grids.overlayGrid.files});
        },
        setEnabled(value) {
            enabled = value;
            if (!enabled) this.clear();
        },
        /** Requests a render of the current view at the given resolution (pixels per sample). */
        request(step) {
            const globe = globeAgent.value();
            if (!globe || globe.is3D) return;  // the 3D view colors its own texture
            if (!enabled) {
                this.clear();
                drawGridPoints(canvas.getContext("2d"), (gridAgent.value() || {}).overlayGrid, globe);
                return;
            }
            const projection = globe.projection;
            pending = {
                type: "render",
                id: nextId++,
                version,
                projection: {
                    name: configuration.get("projection"),
                    rotate: projection.rotate(),
                    scale: projection.scale(),
                    translate: projection.translate()
                },
                width: canvas.width,
                height: canvas.height,
                step,
                alpha: OVERLAY_ALPHA
            };
            flush();
        },
        clear() {
            µ.clearCanvas(canvas);
        }
    };
}

function drawGridPoints(ctx, grid, globe) {
    if (!grid || !globe || !configuration.get("showGridPoints")) return;

    ctx.fillStyle = "rgba(255, 255, 255, 1)";
    // Use the clipping behavior of a projection stream to quickly draw visible points.
    const stream = globe.projection.stream({
        point(x, y) {
            ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
        }
    });
    grid.forEachPoint((λ, φ, d) => {
        if (µ.isValue(d)) {
            stream.point(λ, φ);
        }
    });
}

/** Draws the color bar for the overlay grid in the menu, with a tooltip showing the value under the mouse. */
function drawScaleBar(grid) {
    µ.clearCanvas(d3.select("#scale").node());
    if (!grid) return;
    const colorBar = d3.select("#scale"), scale = grid.scale, bounds = scale.bounds;
    const c = colorBar.node(), g = c.getContext("2d"), n = c.width - 1;
    for (let i = 0; i <= n; i++) {
        const rgb = scale.gradient(µ.spread(i / n, bounds[0], bounds[1]), 1);
        g.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
        g.fillRect(i, 0, 1, c.height);
    }

    // Show tooltip on hover.
    colorBar.on("mousemove", function(event) {
        const x = d3.pointer(event, this)[0];
        const pct = µ.clamp((Math.round(x) - 2) / (n - 2), 0, 1);
        const value = µ.spread(pct, bounds[0], bounds[1]);
        const elementId = grid.type === "wind" ? "#location-wind-units" : "#location-value-units";
        const units = createUnitToggle(elementId, grid).value();
        colorBar.attr("title", µ.formatScalar(value, units) + " " + units.label);
    });
}

/**
 * Extract the date the grids are valid, or the current date if no grid is available.
 */
function validityDate(grids) {
    // When the active layer is considered "current", use its time as now, otherwise use current time as
    // now (but rounded down to the nearest three-hour block).
    const THREE_HOURS = 3 * HOUR;
    const now = grids ? grids.primaryGrid.date.getTime() : Math.floor(Date.now() / THREE_HOURS) * THREE_HOURS;
    const parts = configuration.get("date").split("/");  // yyyy/mm/dd or "current"
    const hhmm = configuration.get("hour");
    return parts.length > 1 ?
        Date.UTC(+parts[0], parts[1] - 1, +parts[2], +hhmm.substring(0, 2)) :
        parts[0] === "current" ? now : null;
}

/**
 * Display the grid's validity date in the menu. Allow toggling between local and UTC time.
 */
function showDate(grids) {
    const date = new Date(validityDate(grids)), isLocal = d3.select("#data-date").classed("local");
    const formatted = isLocal ? µ.toLocalISO(date) : µ.toUTCISO(date);
    d3.select("#data-date").text(formatted + " " + (isLocal ? t("date.local") : t("date.utc")));
    d3.select("#toggle-zone").text("⇄ " + (isLocal ? t("date.utc") : t("date.local")));
}

/**
 * Display the grids' types in the menu.
 */
function showGridDetails(grids) {
    showDate(grids);
    let description = "", center = "";
    if (grids) {
        const langCode = d3.select("body").attr("data-lang") || "en";
        const pd = grids.primaryGrid.description(langCode), od = grids.overlayGrid.description(langCode);
        description = od.name + od.qualifier;
        if (grids.primaryGrid !== grids.overlayGrid) {
            // Combine both grid descriptions together with a " + " if their qualifiers are the same.
            description = (pd.qualifier === od.qualifier ? pd.name : pd.name + pd.qualifier) + " + " + description;
        }
        center = grids.overlayGrid.source;
    }
    d3.select("#data-layer").text(description);
    d3.select("#data-center").text(center);
}

/**
 * Constructs a toggler for the specified product's units, storing the toggle state on the element having
 * the specified id.
 */
function createUnitToggle(id, product) {
    const units = product.units, size = units.length;
    let index = +(d3.select(id).attr("data-index") || 0) % size;
    return {
        value() {
            return units[index];
        },
        next() {
            d3.select(id).attr("data-index", index = ((index + 1) % size));
        }
    };
}

/**
 * Display the specified wind value. Allow toggling between the different types of wind units.
 */
function showWindAtLocation(wind, product) {
    const unitToggle = createUnitToggle("#location-wind-units", product), units = unitToggle.value();
    d3.select("#location-wind").text(µ.formatVector(wind, units));
    d3.select("#location-wind-units").text(units.label).on("click", function() {
        unitToggle.next();
        showWindAtLocation(wind, product);
    });
}

/**
 * Display the specified overlay value. Allow toggling between the different types of supported units.
 */
function showOverlayValueAtLocation(value, product) {
    const unitToggle = createUnitToggle("#location-value-units", product), units = unitToggle.value();
    d3.select("#location-value").text(µ.formatScalar(value, units));
    d3.select("#location-value-units").text(units.label).on("click", function() {
        unitToggle.next();
        showOverlayValueAtLocation(value, product);
    });
}

// Stores the point and coordinate of the currently visible location. This is used to update the location
// details when the field changes.
let activeLocation = {};

/**
 * Display a local data callout at the given [x, y] point and its corresponding [lon, lat] coordinates.
 */
function showLocationDetails(point, coord) {
    point = point || [];
    coord = coord || [];
    const grids = gridAgent.value(), λ = coord[0], φ = coord[1], globe = globeAgent.value();
    if (globe && globe.is3D ? !Number.isFinite(λ) || !Number.isFinite(φ) : !isOnGlobe(globe, point, coord)) {
        return;
    }

    clearLocationDetails(false);  // clean the slate
    activeLocation = {point, coord};  // remember where the current location is
    if (view3d) view3d.setMarker(coord);

    if (Number.isFinite(λ) && Number.isFinite(φ)) {
        d3.select("#location-coord").text(µ.formatCoordinates(λ, φ, t("coord.west")));
        d3.select("#location-close").classed("invisible", false);
    }

    if (grids) {
        const wind = grids.primaryGrid.interpolate(λ, φ);
        if (µ.isValue(wind)) {
            showWindAtLocation(wind, grids.primaryGrid);
        }
        if (grids.overlayGrid !== grids.primaryGrid) {
            const value = grids.overlayGrid.interpolate(λ, φ);
            if (µ.isValue(value)) {
                showOverlayValueAtLocation(value, grids.overlayGrid);
            }
        }
    }
}

function updateLocationDetails() {
    const globe = globeAgent.value(), coord = activeLocation.coord;
    if (globe && coord) {
        // the globe may have moved since the location was picked, so find where it is on screen now
        showLocationDetails(projectVisible(globe, coord), coord);
    }
}

function clearLocationDetails(clearEverything) {
    d3.select("#location-coord").text("");
    d3.select("#location-close").classed("invisible", true);
    d3.select("#location-wind").text("");
    d3.select("#location-wind-units").text("");
    d3.select("#location-value").text("");
    d3.select("#location-value-units").text("");
    if (clearEverything) {
        activeLocation = {};
        d3.select(".location-mark").remove();
        if (view3d) view3d.setMarker(null);
    }
}

function pick(obj, keys) {
    return Object.fromEntries(keys.map(k => [k, obj[k]]));
}

function shallowEqual(a, b) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k]);
}

/**
 * Registers a click event handler for the specified DOM element which modifies the configuration to have
 * the attributes represented by newAttr. The button is highlighted when the configuration matches newAttr
 * (restricted to the given keys, if any).
 */
function bindButtonToConfiguration(elementId, newAttr, keys) {
    keys = keys || Object.keys(newAttr);
    d3.select(elementId).on("click", function() {
        if (d3.select(elementId).classed("disabled")) return;
        configuration.save(newAttr);
    });
    configuration.on("change", function(model) {
        const attr = model.attributes;
        d3.select(elementId).classed("highlighted", shallowEqual(pick(attr, keys), pick(newAttr, keys)));
    });
}

function changedKeys() {
    return Object.keys(configuration.changedAttributes());
}

/**
 * Registers all event handlers to bind components and page elements together.
 */
function init() {
    report.status(t("status.initializing"));

    d3.selectAll(".fill-screen").attr("width", view.width).attr("height", view.height);
    // Adjust size of the scale canvas to fill the width of the menu to the right of the label.
    const label = d3.select("#scale-label").node();
    d3.select("#scale")
        .attr("width", (d3.select("#menu").node().offsetWidth - label.offsetWidth) * 0.97)
        .attr("height", label.offsetHeight / 2);

    d3.select("#show-menu").on("click", function() {
        d3.select("#menu").classed("invisible", !d3.select("#menu").classed("invisible"));
    });

    if (µ.isFF()) {
        // Workaround FF performance issue of slow click behavior on map having thick coastlines.
        d3.select("#display").classed("firefox", true);
    }

    // Tweak document to distinguish CSS styling between touch and non-touch environments.
    if ("ontouchstart" in document.documentElement) {
        d3.select(document).on("touchstart", function() {});  // this hack enables :active pseudoclass
    }
    else {
        d3.select(document.documentElement).classed("no-touch", true);  // to filter styles problematic for touch
    }

    // Bind configuration to URL bar changes.
    d3.select(window).on("hashchange", function() {
        log.debug("hashchange");
        configuration.fetch({trigger: "hashchange"});
    });

    configuration.on("change", report.reset);

    meshAgent.listenTo(configuration, "change:topology", function(model, attr) {
        meshAgent.submit(buildMesh, attr);
    });

    globeAgent.listenTo(configuration, "change:projection", function(model, attr) {
        globeAgent.submit(buildGlobe, attr);
    });

    gridAgent.listenTo(configuration, "change", function() {
        const changed = changedKeys();
        let rebuildRequired = false;

        // Build a new grid if any layer-related attributes have changed.
        if (changed.some(k => ["date", "hour", "param", "surface", "level"].includes(k))) {
            rebuildRequired = true;
        }
        // Build a new grid if the new overlay type is different from the current one.
        const overlayType = configuration.get("overlayType") || "default";
        if (changed.includes("overlayType") && overlayType !== "off") {
            const grids = (gridAgent.value() || {}), primary = grids.primaryGrid, overlay = grids.overlayGrid;
            if (!overlay) {
                // Do a rebuild if we have no overlay grid.
                rebuildRequired = true;
            }
            else if (overlay.type !== overlayType && !(overlayType === "default" && primary === overlay)) {
                // Do a rebuild if the types are different.
                rebuildRequired = true;
            }
        }

        if (rebuildRequired) {
            gridAgent.submit(buildGrids);
        }
    });
    gridAgent.on("submit", () => showGridDetails(null));
    gridAgent.on("update", grids => showGridDetails(grids));
    d3.select("#toggle-zone").on("click", function() {
        d3.select("#data-date").classed("local", !d3.select("#data-date").classed("local"));
        showDate(gridAgent.cancel.requested ? null : gridAgent.value());
    });

    function startRendering() {
        rendererAgent.submit(buildRenderer, meshAgent.value(), globeAgent.value());
    }
    rendererAgent.listenTo(meshAgent, "update", startRendering);
    rendererAgent.listenTo(globeAgent, "update", startRendering);

    // Particle animation: (re)start whenever the data or the globe changes. It keeps running during moves, and
    // when only the time changes the particles carry on with the new grid, so playing the forecast is smooth.
    gridAgent.on("update", function(grids) {
        const sameKind = animator && animator.globe === globeAgent.value() &&
            animator.grids.primaryGrid.type === grids.primaryGrid.type;
        if (sameKind) {
            animator.setGrid(grids.primaryGrid);
            animator.grids = grids;
            report.status("");
        }
        else {
            startAnimation();
        }
    });
    globeAgent.on("update", startAnimation);

    // The 3D globe takes over the display when its projection is selected. three.js is only loaded then.
    let loading3d = null;
    async function sync3d() {
        const globe = globeAgent.value(), wanted = !!(globe && globe.is3D);
        if (!wanted) {
            if (view3d && view3d.visible) {
                view3d.hide();
                d3.select("#display").style("visibility", null);
            }
            return;
        }
        if (!view3d) {
            report.status(t("status.loading3d"));
            loading3d ??= import("./globe3d.js");
            const {createGlobe3D} = await loading3d;
            if (view3d) return sync3d();  // created by a concurrent call
            const rotate = globe.projection.rotate();
            view3d = createGlobe3D(document.body, {
                start: [-rotate[0], -rotate[1]],
                onClick: coord => showLocationDetails(null, coord)
            });
            report.status("");
            if (!(globeAgent.value() || {}).is3D) return sync3d();  // projection changed while loading
        }
        d3.select("#display").style("visibility", "hidden");
        view3d.setMesh(meshAgent.value());
        view3d.setOverlayEnabled(configuration.get("overlayType") !== "off");
        if (gridAgent.value()) view3d.setGrids(gridAgent.value());
        view3d.show();
        if (activeLocation.coord) view3d.setMarker(activeLocation.coord);
    }
    const sync3dSafe = () => sync3d().catch(report.error);
    globeAgent.on("update", sync3dSafe);
    gridAgent.on("update", sync3dSafe);
    meshAgent.on("update", sync3dSafe);
    configuration.on("change:overlayType", () => view3d && view3d.visible && sync3dSafe());
    rendererAgent.on("start", () => animator && animator.setMoving(true));
    rendererAgent.on("render", function() {
        report.status("");
        if (!animator || animator.globe !== globeAgent.value() || animator.grids !== gridAgent.value()) {
            startAnimation();
        }
        else {
            animator.setMoving(false);
        }
    });

    // Color overlay: rendered by a worker, coarse while the globe moves and fine when it stops.
    const overlayEnabled = () => configuration.get("overlayType") !== "off";
    gridAgent.on("update", function(grids) {
        overlay.setGrids(grids);
        overlay.setEnabled(overlayEnabled());
        overlay.request(OVERLAY_STEP);
        drawScaleBar(grids.overlayGrid);
    });
    rendererAgent.on("start", () => overlay.request(OVERLAY_STEP_MOVING));
    rendererAgent.on("redraw", () => overlay.request(OVERLAY_STEP_MOVING));
    rendererAgent.on("render", () => overlay.request(OVERLAY_STEP));
    configuration.on("change", function() {
        // if only overlay relevant flags have changed...
        if (changedKeys().some(k => k === "overlayType" || k === "showGridPoints")) {
            overlay.setEnabled(overlayEnabled());
            overlay.request(OVERLAY_STEP);
        }
    });

    // Add event handlers for showing, updating, and removing location details.
    inputController.on("click", showLocationDetails);
    gridAgent.on("update", updateLocationDetails);
    d3.select("#location-close").on("click", () => clearLocationDetails(true));

    // Modify menu depending on what mode we're in.
    // Rows tagged with data-level (e.g. the wave overlays) only show for that ocean animation.
    configuration.on("change", function(model) {
        if (!changedKeys().some(k => k === "param" || k === "level")) return;
        const mode = model.get("param"), level = model.get("level");
        d3.selectAll(".ocean-mode").classed("invisible", function() {
            return mode !== "ocean" || (this.dataset.level !== undefined && this.dataset.level !== level);
        });
        d3.selectAll(".wind-mode").classed("invisible", mode !== "wind");
        switch (mode === "ocean" && level === "waves" ? "wind" : mode) {  // waves follow the 3-hourly GFS steps
            case "wind":
                d3.select("#nav-backward-more").attr("title", "-1 Day");
                d3.select("#nav-backward").attr("title", "-3 Hours");
                d3.select("#nav-forward").attr("title", "+3 Hours");
                d3.select("#nav-forward-more").attr("title", "+1 Day");
                break;
            case "ocean":
                d3.select("#nav-backward-more").attr("title", "-1 Month");
                d3.select("#nav-backward").attr("title", "-5 Days");
                d3.select("#nav-forward").attr("title", "+5 Days");
                d3.select("#nav-forward-more").attr("title", "+1 Month");
                break;
        }
    });

    // Add handlers for mode buttons.
    d3.select("#wind-mode-enable").on("click", function() {
        if (configuration.get("param") !== "wind") {
            configuration.save({param: "wind", surface: "surface", level: "level", overlayType: "default"});
        }
    });
    configuration.on("change:param", function(model, param) {
        d3.select("#wind-mode-enable").classed("highlighted", param === "wind");
    });
    d3.select("#ocean-mode-enable").on("click", function() {
        if (configuration.get("param") !== "ocean") {
            // When switching between modes, there may be no associated data for the current date. So we need
            // find the closest available according to the catalog. This is not necessary if date is "current".
            const ocean = {param: "ocean", surface: "surface", level: "waves", overlayType: "default"};
            const attr = {...configuration.attributes};
            if (attr.date === "current") {
                configuration.save(ocean);
            }
            else {
                Promise.all(products.productsFor({...attr, ...ocean})).then(([product]) => {
                    if (product.date) {
                        configuration.save({...ocean, ...µ.dateToConfig(product.date)});
                    }
                }).catch(report.error);
            }
            stopAnimation(true);  // cleanup particle artifacts over continents
        }
    });
    configuration.on("change:param", function(model, param) {
        d3.select("#ocean-mode-enable").classed("highlighted", param === "ocean");
    });

    // Add logic to disable buttons that are incompatible with each other.
    configuration.on("change:overlayType", function(model, ot) {
        d3.select("#surface-level").classed("disabled", ot === "air_density" || ot === "wind_power_density");
    });
    configuration.on("change:surface", function(model, s) {
        d3.select("#overlay-air_density").classed("disabled", s === "surface");
        d3.select("#overlay-wind_power_density").classed("disabled", s === "surface");
    });

    // Add event handlers for the time navigation buttons.
    d3.select("#nav-backward-more").on("click", () => navigate(-10));
    d3.select("#nav-forward-more").on("click", () => navigate(+10));
    d3.select("#nav-backward").on("click", () => navigate(-1));
    d3.select("#nav-forward").on("click", () => navigate(+1));
    d3.select("#nav-now").on("click", () => configuration.save({date: "current", hour: ""}));

    d3.select("#option-show-grid").on("click", function() {
        configuration.save({showGridPoints: !configuration.get("showGridPoints")});
    });
    configuration.on("change:showGridPoints", function(model, showGridPoints) {
        d3.select("#option-show-grid").classed("highlighted", showGridPoints);
    });

    // Add handlers for all wind level buttons.
    d3.selectAll(".surface").each(function() {
        const id = this.id, parts = id.split("-");
        bindButtonToConfiguration("#" + id, {param: "wind", surface: parts[0], level: parts[1]});
    });

    // Add handlers for ocean animation types.
    // The currents are a 2014 sample, so coming back to the waves also comes back to the latest forecast.
    bindButtonToConfiguration("#animate-waves",
        {param: "ocean", surface: "surface", level: "waves", date: "current", hour: ""}, ["param", "surface", "level"]);
    bindButtonToConfiguration("#animate-currents", {param: "ocean", surface: "surface", level: "currents"});

    // Add handlers for all overlay buttons.
    products.overlayTypes.forEach(type => {
        bindButtonToConfiguration("#overlay-" + type, {overlayType: type});
    });
    bindButtonToConfiguration("#overlay-wind", {param: "wind", overlayType: "default"});
    bindButtonToConfiguration("#overlay-ocean-off", {overlayType: "off"});
    bindButtonToConfiguration("#overlay-waves-off", {overlayType: "off"});
    bindButtonToConfiguration("#overlay-wave_height", {overlayType: "default"});
    bindButtonToConfiguration("#overlay-currents", {overlayType: "default"});

    // Add handlers for all projection buttons.
    for (const p of globes.keys()) {
        bindButtonToConfiguration("#" + p, {projection: p, orientation: ""}, ["projection"]);
    }

    // When the view size changes (resize or device rotation), resize canvases and rebuild the globe.
    const onResize = µ.debounce(function() {
        view = µ.view();
        d3.selectAll(".fill-screen").attr("width", view.width).attr("height", view.height);
        globeAgent.submit(buildGlobe, configuration.get("projection"));
    }, 250);
    d3.select(window).on("resize", onResize).on("orientationchange", onResize);
}

/**
 * The time slider lists the forecast steps found in /data/weather/catalog.json (written by fetch_gfs.py). Moving
 * it, or pressing play, navigates the configuration to that time. While playing, the next step is requested a
 * moment after the previous one has been displayed.
 */
function buildTimeline() {
    const row = d3.select("#time-row"), slider = d3.select("#time-slider");
    const label = d3.select("#time-label"), play = d3.select("#time-play");
    const PLAY_DELAY = 700;  // ms to show each step while playing
    let times = [], playing = false, timer = null;

    const format = date => date.toLocaleString(locale(), {weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});

    function nearestIndex(time) {
        let best = 0;
        times.forEach((t, i) => {
            if (Math.abs(t - time) < Math.abs(times[best] - time)) best = i;
        });
        return best;
    }

    function sync() {
        if (times.length === 0) return;
        const time = validityDate(gridAgent.value());
        if (time === null) return;
        const i = nearestIndex(time);
        slider.property("value", i);
        label.text(format(times[i]));
    }

    function goTo(i) {
        configuration.save(µ.dateToConfig(times[i]));
    }

    const goToDebounced = µ.debounce(goTo, 150);

    function stop() {
        playing = false;
        clearTimeout(timer);
        play.text("▶").classed("highlighted", false);
    }

    function advance() {
        if (!playing) return;
        const next = (+slider.property("value") + 1) % times.length;
        slider.property("value", next);
        label.text(format(times[next]));
        goTo(next);
    }

    slider.on("input", function() {
        stop();
        const i = +this.value;
        label.text(format(times[i]));
        goToDebounced(i);
    });
    play.on("click", function() {
        if (playing) {
            stop();
        }
        else if (times.length > 1) {
            playing = true;
            play.text("❚❚").classed("highlighted", true);
            advance();
        }
    });
    gridAgent.on("update", function() {
        sync();
        if (playing) {
            clearTimeout(timer);
            timer = setTimeout(advance, PLAY_DELAY);
        }
    });
    gridAgent.on("reject", () => playing && (timer = setTimeout(advance, PLAY_DELAY)));  // skip missing steps
    // The timeline follows the GFS forecast steps: wind mode and ocean waves (not the 2014 currents sample).
    const usesTimeline = () => configuration.get("param") === "wind" || configuration.get("level") === "waves";
    configuration.on("change", () => {
        if (!changedKeys().some(k => k === "param" || k === "level")) return;
        row.classed("invisible", times.length < 2 || !usesTimeline());
        if (!usesTimeline()) stop();
    });

    µ.loadJson("/data/weather/catalog.json").then(catalog => {
        times = catalog.times.map(t => new Date(t));
        slider.attr("max", Math.max(times.length - 1, 0));
        row.classed("invisible", times.length < 2 || !usesTimeline());
        sync();
    }).catch(() => row.classed("invisible", true));
}

function start() {
    // Everything is now set up, so load configuration from the hash fragment and kick off change events.
    configuration.fetch();
}

try {
    init();
    buildTimeline();
    start();
} catch (e) {
    report.error(e);
}
