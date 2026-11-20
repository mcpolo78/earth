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

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const MAX_TASK_TIME = 100;                  // amount of time before a task yields control (millis)
const MIN_SLEEP_TIME = 25;                  // amount of time a task waits before resuming (millis)
const MIN_MOVE = 4;                         // slack before a drag operation beings (pixels)
const MOVE_END_WAIT = 1000;                 // time to wait for a move operation to be considered done (millis)

const OVERLAY_ALPHA = Math.floor(0.4 * 255);  // overlay transparency (on scale [0, 255])
const INTENSITY_SCALE_STEP = 10;            // step size of particle intensity color scale
const MAX_PARTICLE_AGE = 100;               // max number of frames a particle is drawn before regeneration
const PARTICLE_LINE_WIDTH = 1.0;            // line width of a drawn particle
const PARTICLE_MULTIPLIER = 7;              // particle count scalar (completely arbitrary--this values looks nice)
const PARTICLE_REDUCTION = 0.75;            // reduce particle count to this much of normal for mobile devices
const FRAME_RATE = 40;                      // desired milliseconds per frame

const NULL_WIND_VECTOR = [NaN, NaN, null];  // singleton for undefined location outside the vector field [u, v, mag]
const HOLE_VECTOR = [NaN, NaN, null];       // singleton that signifies a hole in the vector field
const TRANSPARENT_BLACK = [0, 0, 0, 0];     // singleton 0 rgba
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
                case -1: msg = "Server Down"; break;
                case 404: msg = "No Data"; break;
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
const fieldAgent = newAgent();     // the interpolated wind vector field
const animatorAgent = newAgent();  // the wind animator
const overlayAgent = newAgent();   // color overlay over the animation

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
            report.status("Finding current position...");
            navigator.geolocation.getCurrentPosition(function(pos) {
                report.status("");
                const coord = [pos.coords.longitude, pos.coords.latitude], rotate = globe.locate(coord);
                if (rotate) {
                    globe.projection.rotate(rotate);
                    configuration.save({orientation: globe.orientation()});  // triggers reorientation
                }
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
    report.status("Downloading...");
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
    report.status("Downloading...");
    log.time("build grids");
    // UNDONE: upon failure to load a product, the unloaded product should still be stored in the agent.
    //         this allows us to use the product for navigation and other state.
    const cancel = this.cancel;
    downloadsInProgress++;
    try {
        const loaded = await Promise.all(products.productsFor(configuration.attributes)
            .map(async product => (await product).load(cancel)));
        log.timeEnd("build grids");
        return {primaryGrid: loaded[0], overlayGrid: loaded[1] || loaded[0]};
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

    report.status("Rendering Globe...");
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
        if (fieldAgent.value() && !fieldAgent.value().isInsideBoundary(point[0], point[1])) {
            return;  // outside the field boundary, so ignore.
        }
        if (coord && Number.isFinite(coord[0]) && Number.isFinite(coord[1])) {
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

function createMask(globe) {
    if (!globe) return null;

    log.time("render mask");

    // Create a detached canvas, ask the model to define the mask polygon, then fill with an opaque color.
    const width = view.width, height = view.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = globe.defineMask(canvas.getContext("2d", {willReadFrequently: true}));
    context.fillStyle = "rgba(255, 0, 0, 1)";
    context.fill();

    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;  // layout: [r, g, b, a, r, g, b, a, ...]
    log.timeEnd("render mask");
    return {
        imageData,
        isVisible(x, y) {
            const i = (y * width + x) * 4;
            return data[i + 3] > 0;  // non-zero alpha means pixel is visible
        },
        set(x, y, rgba) {
            const i = (y * width + x) * 4;
            data[i    ] = rgba[0];
            data[i + 1] = rgba[1];
            data[i + 2] = rgba[2];
            data[i + 3] = rgba[3];
            return this;
        }
    };
}

function createField(columns, bounds, mask) {

    /**
     * @returns {Array} wind vector [u, v, magnitude] at the point (x, y), or [NaN, NaN, null] if wind
     *          is undefined at that point.
     */
    function field(x, y) {
        const column = columns[Math.round(x)];
        return column && column[Math.round(y)] || NULL_WIND_VECTOR;
    }

    /** @returns {boolean} true if the field is valid at the point (x, y) */
    field.isDefined = function(x, y) {
        return field(x, y)[2] !== null;
    };

    /**
     * @returns {boolean} true if the point (x, y) lies inside the outer boundary of the vector field, even if
     *          the vector field has a hole (is undefined) at that point, such as at an island in a field of
     *          ocean currents.
     */
    field.isInsideBoundary = function(x, y) {
        return field(x, y) !== NULL_WIND_VECTOR;
    };

    // Frees the massive "columns" array for GC.
    field.release = function() {
        columns = [];
    };

    field.randomize = function(o) {  // UNDONE: this method is terrible
        let x, y;
        let safetyNet = 0;
        do {
            x = µ.randomInt(bounds.x, bounds.xMax);
            y = µ.randomInt(bounds.y, bounds.yMax);
        } while (!field.isDefined(x, y) && safetyNet++ < 30);
        o.x = x;
        o.y = y;
        return o;
    };

    field.overlay = mask.imageData;

    return field;
}

/**
 * Calculate distortion of the wind vector caused by the shape of the projection at point (x, y). The wind
 * vector is modified in place and returned by this function.
 */
function distort(projection, λ, φ, x, y, scale, wind) {
    const u = wind[0] * scale;
    const v = wind[1] * scale;
    const d = µ.distortion(projection, λ, φ, x, y);

    // Scale distortion vectors by u and v, then add.
    wind[0] = d[0] * u + d[2] * v;
    wind[1] = d[1] * u + d[3] * v;
    return wind;
}

function interpolateField(globe, grids) {
    if (!globe || !grids) return null;

    const mask = createMask(globe);
    const primaryGrid = grids.primaryGrid;
    const overlayGrid = grids.overlayGrid;

    log.time("interpolating field");
    const cancel = this.cancel;

    const projection = globe.projection;
    const bounds = globe.bounds(view);
    // How fast particles move on the screen (arbitrary value chosen for aesthetics).
    const velocityScale = bounds.height * primaryGrid.particles.velocityScale;

    const columns = [];
    const point = [];
    let x = bounds.x;
    const interpolate = primaryGrid.interpolate;
    const overlayInterpolate = overlayGrid.interpolate;
    const hasDistinctOverlay = primaryGrid !== overlayGrid;
    const scale = overlayGrid.scale;

    function interpolateColumn(x) {
        const column = [];
        for (let y = bounds.y; y <= bounds.yMax; y += 2) {
            if (mask.isVisible(x, y)) {
                point[0] = x; point[1] = y;
                const coord = projection.invert(point);
                let color = TRANSPARENT_BLACK;
                let wind = null;
                if (coord) {
                    const λ = coord[0], φ = coord[1];
                    if (isFinite(λ)) {
                        wind = interpolate(λ, φ);
                        let scalar = null;
                        if (wind) {
                            wind = distort(projection, λ, φ, x, y, velocityScale, wind);
                            scalar = wind[2];
                        }
                        if (hasDistinctOverlay) {
                            scalar = overlayInterpolate(λ, φ);
                        }
                        if (µ.isValue(scalar)) {
                            color = scale.gradient(scalar, OVERLAY_ALPHA);
                        }
                    }
                }
                column[y + 1] = column[y] = wind || HOLE_VECTOR;
                mask.set(x, y, color).set(x + 1, y, color).set(x, y + 1, color).set(x + 1, y + 1, color);
            }
        }
        columns[x + 1] = columns[x] = column;
    }

    report.status("");

    return new Promise((resolve, reject) => {
        (function batchInterpolate() {
            try {
                if (!cancel.requested) {
                    const start = Date.now();
                    while (x < bounds.xMax) {
                        interpolateColumn(x);
                        x += 2;
                        if ((Date.now() - start) > MAX_TASK_TIME) {
                            // Interpolation is taking too long. Schedule the next batch for later and yield.
                            report.progress((x - bounds.x) / (bounds.xMax - bounds.x));
                            setTimeout(batchInterpolate, MIN_SLEEP_TIME);
                            return;
                        }
                    }
                }
                resolve(createField(columns, bounds, mask));
            }
            catch (e) {
                reject(e);
            }
            report.progress(1);  // 100% complete
            log.timeEnd("interpolating field");
        })();
    });
}

function animate(globe, field, grids) {
    if (!globe || !field || !grids) return;

    const cancel = this.cancel;
    const bounds = globe.bounds(view);
    // maxIntensity is the velocity at which particle color intensity is maximum
    const colorStyles = µ.windIntensityColorScale(INTENSITY_SCALE_STEP, grids.primaryGrid.particles.maxIntensity);
    const buckets = colorStyles.map(() => []);
    let particleCount = Math.round(bounds.width * PARTICLE_MULTIPLIER);
    if (µ.isMobile()) {
        particleCount *= PARTICLE_REDUCTION;
    }
    const fadeFillStyle = µ.isFF() ? "rgba(0, 0, 0, 0.95)" : "rgba(0, 0, 0, 0.97)";  // FF Mac alpha behaves oddly

    log.debug("particle count: " + particleCount);
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
        particles.push(field.randomize({age: µ.randomInt(0, MAX_PARTICLE_AGE)}));
    }

    function evolve() {
        buckets.forEach(bucket => { bucket.length = 0; });
        particles.forEach(particle => {
            if (particle.age > MAX_PARTICLE_AGE) {
                field.randomize(particle).age = 0;
            }
            const x = particle.x;
            const y = particle.y;
            const v = field(x, y);  // vector at current position
            const m = v[2];
            if (m === null) {
                particle.age = MAX_PARTICLE_AGE;  // particle has escaped the grid, never to return...
            }
            else {
                const xt = x + v[0];
                const yt = y + v[1];
                if (field.isDefined(xt, yt)) {
                    // Path from (x,y) to (xt,yt) is visible, so add this particle to the appropriate draw bucket.
                    particle.xt = xt;
                    particle.yt = yt;
                    buckets[colorStyles.indexFor(m)].push(particle);
                }
                else {
                    // Particle isn't visible, but it still moves through the field.
                    particle.x = xt;
                    particle.y = yt;
                }
            }
            particle.age += 1;
        });
    }

    const g = d3.select("#animation").node().getContext("2d");
    g.lineWidth = PARTICLE_LINE_WIDTH;
    g.fillStyle = fadeFillStyle;

    function draw() {
        // Fade existing particle trails.
        const prev = g.globalCompositeOperation;
        g.globalCompositeOperation = "destination-in";
        g.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
        g.globalCompositeOperation = prev;

        // Draw new particle trails.
        buckets.forEach((bucket, i) => {
            if (bucket.length > 0) {
                g.beginPath();
                g.strokeStyle = colorStyles[i];
                bucket.forEach(particle => {
                    g.moveTo(particle.x, particle.y);
                    g.lineTo(particle.xt, particle.yt);
                    particle.x = particle.xt;
                    particle.y = particle.yt;
                });
                g.stroke();
            }
        });
    }

    (function frame() {
        try {
            if (cancel.requested) {
                field.release();
                return;
            }
            evolve();
            draw();
            setTimeout(frame, FRAME_RATE);
        }
        catch (e) {
            report.error(e);
        }
    })();
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

function drawOverlay(field, overlayType) {
    if (!field) return;

    const ctx = d3.select("#overlay").node().getContext("2d"), grid = (gridAgent.value() || {}).overlayGrid;

    µ.clearCanvas(d3.select("#overlay").node());
    µ.clearCanvas(d3.select("#scale").node());
    if (overlayType) {
        if (overlayType !== "off") {
            ctx.putImageData(field.overlay, 0, 0);
        }
        drawGridPoints(ctx, grid, globeAgent.value());
    }

    if (grid) {
        // Draw color bar for reference.
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
    d3.select("#data-date").text(formatted + " " + (isLocal ? "Local" : "UTC"));
    d3.select("#toggle-zone").text("⇄ " + (isLocal ? "UTC" : "Local"));
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
    const grids = gridAgent.value(), field = fieldAgent.value(), λ = coord[0], φ = coord[1];
    if (!field || !field.isInsideBoundary(point[0], point[1])) {
        return;
    }

    clearLocationDetails(false);  // clean the slate
    activeLocation = {point, coord};  // remember where the current location is

    if (Number.isFinite(λ) && Number.isFinite(φ)) {
        d3.select("#location-coord").text(µ.formatCoordinates(λ, φ));
        d3.select("#location-close").classed("invisible", false);
    }

    if (field.isDefined(point[0], point[1]) && grids) {
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
    showLocationDetails(activeLocation.point, activeLocation.coord);
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
    }
}

function stopCurrentAnimation(alsoClearCanvas) {
    animatorAgent.cancel();
    if (alsoClearCanvas) {
        µ.clearCanvas(d3.select("#animation").node());
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
    report.status("Initializing...");

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

    function startInterpolation() {
        fieldAgent.submit(interpolateField, globeAgent.value(), gridAgent.value());
    }
    function cancelInterpolation() {
        fieldAgent.cancel();
    }
    fieldAgent.listenTo(gridAgent, "update", startInterpolation);
    fieldAgent.listenTo(rendererAgent, "render", startInterpolation);
    fieldAgent.listenTo(rendererAgent, "start", cancelInterpolation);
    fieldAgent.listenTo(rendererAgent, "redraw", cancelInterpolation);

    animatorAgent.listenTo(fieldAgent, "update", function(field) {
        animatorAgent.submit(animate, globeAgent.value(), field, gridAgent.value());
    });
    animatorAgent.listenTo(rendererAgent, "start", () => stopCurrentAnimation(true));
    animatorAgent.listenTo(gridAgent, "submit", () => stopCurrentAnimation(false));
    animatorAgent.listenTo(fieldAgent, "submit", () => stopCurrentAnimation(false));

    overlayAgent.listenTo(fieldAgent, "update", function() {
        overlayAgent.submit(drawOverlay, fieldAgent.value(), configuration.get("overlayType"));
    });
    overlayAgent.listenTo(rendererAgent, "start", function() {
        overlayAgent.submit(drawOverlay, fieldAgent.value(), null);
    });
    overlayAgent.listenTo(configuration, "change", function() {
        // if only overlay relevant flags have changed...
        if (changedKeys().some(k => k === "overlayType" || k === "showGridPoints")) {
            overlayAgent.submit(drawOverlay, fieldAgent.value(), configuration.get("overlayType"));
        }
    });

    // Add event handlers for showing, updating, and removing location details.
    inputController.on("click", showLocationDetails);
    fieldAgent.on("update", updateLocationDetails);
    d3.select("#location-close").on("click", () => clearLocationDetails(true));

    // Modify menu depending on what mode we're in.
    configuration.on("change:param", function(model, mode) {
        d3.selectAll(".ocean-mode").classed("invisible", mode !== "ocean");
        d3.selectAll(".wind-mode").classed("invisible", mode !== "wind");
        switch (mode) {
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
            const ocean = {param: "ocean", surface: "surface", level: "currents", overlayType: "default"};
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
            stopCurrentAnimation(true);  // cleanup particle artifacts over continents
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
    bindButtonToConfiguration("#animate-currents", {param: "ocean", surface: "surface", level: "currents"});

    // Add handlers for all overlay buttons.
    products.overlayTypes.forEach(type => {
        bindButtonToConfiguration("#overlay-" + type, {overlayType: type});
    });
    bindButtonToConfiguration("#overlay-wind", {param: "wind", overlayType: "default"});
    bindButtonToConfiguration("#overlay-ocean-off", {overlayType: "off"});
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

function start() {
    // Everything is now set up, so load configuration from the hash fragment and kick off change events.
    configuration.fetch();
}

try {
    init();
    start();
} catch (e) {
    report.error(e);
}
