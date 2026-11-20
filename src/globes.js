/**
 * globes - a set of models of the earth, each having their own kind of projection and onscreen behavior.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
import * as d3 from "d3";
import { geoMollweide, geoWinkel3 } from "d3-geo-projection";
import { geoPolyhedralWaterman } from "d3-geo-polygon";
import * as µ from "./micro.js";

/**
 * @returns {Array} rotation of globe to current position of the user. Aside from asking for geolocation,
 *          which user may reject, there is not much available except timezone. Better than nothing.
 */
function currentPosition() {
    const λ = µ.floorMod(new Date().getTimezoneOffset() / 4, 360);  // 24 hours * 60 min / 4 === 360 degrees
    return [λ, 0];
}

function ensureNumber(num, fallback) {
    return Number.isFinite(num) || num === Infinity || num === -Infinity ? num : fallback;
}

/**
 * @param bounds the projection bounds: [[x0, y0], [x1, y1]]
 * @param view the view bounds {width:, height:}
 * @returns {Object} the projection bounds clamped to the specified view.
 */
function clampedBounds(bounds, view) {
    const upperLeft = bounds[0];
    const lowerRight = bounds[1];
    const x = Math.max(Math.floor(ensureNumber(upperLeft[0], 0)), 0);
    const y = Math.max(Math.floor(ensureNumber(upperLeft[1], 0)), 0);
    const xMax = Math.min(Math.ceil(ensureNumber(lowerRight[0], view.width)), view.width - 1);
    const yMax = Math.min(Math.ceil(ensureNumber(lowerRight[1], view.height)), view.height - 1);
    return {x, y, xMax, yMax, width: xMax - x + 1, height: yMax - y + 1};
}

function hemisphereGraticule() {
    return d3.geoGraticule().stepMinor([0, 90]).stepMajor([0, 90]);
}

/**
 * Returns a globe object with standard behavior. At least the newProjection method must be overridden to
 * be functional.
 */
function standardGlobe() {
    return {
        /** This globe's current D3 projection. */
        projection: null,

        /**
         * @param view the size of the view as {width:, height:}.
         * @returns {Object} a new D3 projection of this globe appropriate for the specified view port.
         */
        newProjection(view) {
            throw new Error("method must be overridden");
        },

        /** @returns the bounds of the current projection clamped to the specified view. */
        bounds(view) {
            return clampedBounds(d3.geoPath().projection(this.projection).bounds({type: "Sphere"}), view);
        },

        /** @returns {Number} the projection scale at which the entire globe fits within the specified view. */
        fit(view) {
            const defaultProjection = this.newProjection(view);
            const bounds = d3.geoPath().projection(defaultProjection).bounds({type: "Sphere"});
            const hScale = (bounds[1][0] - bounds[0][0]) / defaultProjection.scale();
            const vScale = (bounds[1][1] - bounds[0][1]) / defaultProjection.scale();
            return Math.min(view.width / hScale, view.height / vScale) * 0.9;
        },

        /** @returns {Array} the projection transform at which the globe is centered within the specified view. */
        center(view) {
            return [view.width / 2, view.height / 2];
        },

        /** @returns {Array} the range at which this globe can be zoomed. */
        scaleExtent() {
            return [25, 3000];
        },

        /**
         * Returns the current orientation of this globe as a string. If the arguments are specified,
         * mutates this globe to match the specified orientation string, usually in the form "lat,lon,scale".
         */
        orientation(o, view) {
            const projection = this.projection, rotate = projection.rotate();
            if (µ.isValue(o)) {
                const parts = o.split(","), λ = +parts[0], φ = +parts[1], scale = +parts[2];
                const extent = this.scaleExtent();
                projection.rotate(o !== "" && Number.isFinite(λ) && Number.isFinite(φ) ?
                    [-λ, -φ, rotate[2]] :
                    this.newProjection(view).rotate());
                projection.scale(parts.length > 2 && Number.isFinite(scale) ?
                    µ.clamp(scale, extent[0], extent[1]) :
                    this.fit(view));
                projection.translate(this.center(view));
                return this;
            }
            return [(-rotate[0]).toFixed(2), (-rotate[1]).toFixed(2), Math.round(projection.scale())].join(",");
        },

        /**
         * Returns an object that mutates this globe's current projection during a drag/zoom operation.
         * Each drag/zoom event invokes the move() method, and when the move is complete, the end() method
         * is invoked.
         */
        manipulator(startMouse, startScale) {
            const projection = this.projection;
            const sensitivity = 60 / startScale;  // seems to provide a good drag scaling factor
            const rotation = [projection.rotate()[0] / sensitivity, -projection.rotate()[1] / sensitivity];
            const original = projection.precision();
            projection.precision(original * 10);
            return {
                move(mouse, scale) {
                    if (mouse) {
                        const xd = mouse[0] - startMouse[0] + rotation[0];
                        const yd = mouse[1] - startMouse[1] + rotation[1];
                        projection.rotate([xd * sensitivity, -yd * sensitivity, projection.rotate()[2]]);
                    }
                    projection.scale(scale);
                },
                end() {
                    projection.precision(original);
                }
            };
        },

        /** @returns {Array} the transform to apply, if any, to orient this globe to the specified coordinates. */
        locate(coord) {
            return null;
        },

        /** Draws a polygon on the specified context of this globe's boundary. */
        defineMask(context) {
            d3.geoPath().projection(this.projection).context(context)({type: "Sphere"});
            return context;
        },

        /** Appends the SVG elements that render this globe. */
        defineMap(mapSvg, foregroundSvg) {
            const path = d3.geoPath().projection(this.projection);
            const defs = mapSvg.append("defs");
            defs.append("path")
                .attr("id", "sphere")
                .datum({type: "Sphere"})
                .attr("d", path);
            mapSvg.append("use")
                .attr("href", "#sphere")
                .attr("class", "background-sphere");
            mapSvg.append("path")
                .attr("class", "graticule")
                .datum(d3.geoGraticule())
                .attr("d", path);
            mapSvg.append("path")
                .attr("class", "hemisphere")
                .datum(hemisphereGraticule())
                .attr("d", path);
            mapSvg.append("path")
                .attr("class", "coastline");
            mapSvg.append("path")
                .attr("class", "lakes");
            foregroundSvg.append("use")
                .attr("href", "#sphere")
                .attr("class", "foreground-sphere");
        }
    };
}

function newGlobe(source, view) {
    const result = Object.assign(standardGlobe(), source);
    result.projection = result.newProjection(view);
    return result;
}

// ============================================================================================

function atlantis() {
    return newGlobe({
        newProjection() {
            return geoMollweide().rotate([30, -45, 90]).precision(0.1);
        }
    });
}

function azimuthalEquidistant() {
    return newGlobe({
        newProjection() {
            return d3.geoAzimuthalEquidistant().precision(0.1).rotate([0, -90]).clipAngle(180 - 0.001);
        }
    });
}

function conicEquidistant() {
    return newGlobe({
        newProjection() {
            return d3.geoConicEquidistant().rotate(currentPosition()).precision(0.1);
        },
        center(view) {
            return [view.width / 2, view.height / 2 + view.height * 0.065];
        }
    });
}

function equirectangular() {
    return newGlobe({
        newProjection() {
            return d3.geoEquirectangular().rotate(currentPosition()).precision(0.1);
        }
    });
}

function orthographic() {
    return newGlobe({
        newProjection() {
            return d3.geoOrthographic().rotate(currentPosition()).precision(0.1).clipAngle(90);
        },
        defineMap(mapSvg, foregroundSvg) {
            const path = d3.geoPath().projection(this.projection);
            const defs = mapSvg.append("defs");
            const gradientFill = defs.append("radialGradient")
                .attr("id", "orthographic-fill")
                .attr("gradientUnits", "objectBoundingBox")
                .attr("cx", "50%").attr("cy", "49%").attr("r", "50%");
            gradientFill.append("stop").attr("stop-color", "#303030").attr("offset", "69%");
            gradientFill.append("stop").attr("stop-color", "#202020").attr("offset", "91%");
            gradientFill.append("stop").attr("stop-color", "#000005").attr("offset", "96%");
            defs.append("path")
                .attr("id", "sphere")
                .datum({type: "Sphere"})
                .attr("d", path);
            mapSvg.append("use")
                .attr("href", "#sphere")
                .attr("fill", "url(#orthographic-fill)");
            mapSvg.append("path")
                .attr("class", "graticule")
                .datum(d3.geoGraticule())
                .attr("d", path);
            mapSvg.append("path")
                .attr("class", "hemisphere")
                .datum(hemisphereGraticule())
                .attr("d", path);
            mapSvg.append("path")
                .attr("class", "coastline");
            mapSvg.append("path")
                .attr("class", "lakes");
            foregroundSvg.append("use")
                .attr("href", "#sphere")
                .attr("class", "foreground-sphere");
        },
        locate(coord) {
            return [-coord[0], -coord[1], this.projection.rotate()[2]];
        }
    });
}

function stereographic(view) {
    return newGlobe({
        newProjection(view) {
            return d3.geoStereographic()
                .rotate([-43, -20])
                .precision(1.0)
                .clipAngle(180 - 0.0001)
                .clipExtent([[0, 0], [view.width, view.height]]);
        }
    }, view);
}

function waterman() {
    return newGlobe({
        newProjection() {
            return geoPolyhedralWaterman().rotate([20, 0]).precision(0.1);
        },
        defineMap(mapSvg, foregroundSvg) {
            const path = d3.geoPath().projection(this.projection);
            const defs = mapSvg.append("defs");
            defs.append("path")
                .attr("id", "sphere")
                .datum({type: "Sphere"})
                .attr("d", path);
            defs.append("clipPath")
                .attr("id", "clip")
                .append("use")
                .attr("href", "#sphere");
            mapSvg.append("use")
                .attr("href", "#sphere")
                .attr("class", "background-sphere");
            mapSvg.append("path")
                .attr("class", "graticule")
                .attr("clip-path", "url(#clip)")
                .datum(d3.geoGraticule())
                .attr("d", path);
            mapSvg.append("path")
                .attr("class", "coastline")
                .attr("clip-path", "url(#clip)");
            mapSvg.append("path")
                .attr("class", "lakes")
                .attr("clip-path", "url(#clip)");
            foregroundSvg.append("use")
                .attr("href", "#sphere")
                .attr("class", "foreground-sphere");
        }
    });
}

function winkel3() {
    return newGlobe({
        newProjection() {
            return geoWinkel3().precision(0.1);
        }
    });
}

export const globes = new Map([
    ["atlantis", atlantis],
    ["azimuthal_equidistant", azimuthalEquidistant],
    ["conic_equidistant", conicEquidistant],
    ["equirectangular", equirectangular],
    ["orthographic", orthographic],
    ["stereographic", stereographic],
    ["waterman", waterman],
    ["winkel3", winkel3]
]);
