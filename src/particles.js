/**
 * particles - wind particle animation that lives in geographic space.
 *
 * The original implementation advected particles through a screen-space vector field that had to be rebuilt
 * (pixel by pixel, on the main thread) after every drag or zoom, so the animation vanished while the globe moved
 * and for about a second afterwards. Here particles carry their own longitude/latitude, are moved directly with
 * the weather grid's interpolator, and are projected to the screen every frame with the globe's *current*
 * projection. Dragging or zooming the globe therefore never interrupts the animation.
 */
import * as µ from "./micro.js";

const DEG = 180 / Math.PI;
const BASE_FRAME_MS = 40;          // the original animation ran at 25 fps; speeds and fading are tuned for that
const MAX_PARTICLE_AGE = 100;      // max number of (base) frames a particle lives before regeneration
const INTENSITY_SCALE_STEP = 10;   // step size of particle intensity color scale
const MAX_SEGMENT = 40;            // longest segment (px) drawn in one frame; longer ones are projection seams
const POLAR_LIMIT = 89;            // particles closer to the poles than this are regenerated
const HISTORY = 8;                 // positions remembered per particle, to redraw trails while the globe moves
const HISTORY_INTERVAL = 3;        // base frames between two remembered positions
const SWEEP_INTERVAL = 25;         // base frames between two sweeps of faint trail pixels
const SWEEP_ALPHA = 40;            // trail pixels fainter than this (of 255) lose SWEEP_STEP more alpha per sweep
const SWEEP_STEP = 12;

/**
 * @param canvas the animation canvas
 * @param globe the current globe (its projection is read on every frame, so it can be mutated while animating)
 * @param grid the primary (vector) grid: interpolate(λ, φ) -> [u, v, magnitude] or null
 * @param options {particleCount, getView}
 */
export function createAnimator(canvas, globe, initialGrid, options) {
    let grid = initialGrid;
    const g = canvas.getContext("2d", {willReadFrequently: false});
    const projection = globe.projection;
    const colorStyles = µ.windIntensityColorScale(INTENSITY_SCALE_STEP, grid.particles.maxIntensity);
    const buckets = colorStyles.map(() => []);
    // Degrees moved per (m/s of wind) per base frame. The original moved particles by
    // wind * boundsHeight * velocityScale *degrees* per frame (the projection's distortion then converted degrees
    // to pixels), so the same rule here gives the same look, including faster motion when zoomed in.
    let degreesPerUnit = 0;
    const fadeAlpha = µ.isFF() ? 0.95 : 0.97;

    let count = Math.max(1, Math.round(options.particleCount));
    const λs = new Float64Array(count), φs = new Float64Array(count);
    const ages = new Float64Array(count);
    // Ring buffer of recent positions, used to redraw whole trails with the current projection while the globe
    // is being moved (the faded pixels on the canvas would otherwise be left where the map used to be).
    const histλ = new Float32Array(count * HISTORY), histφ = new Float32Array(count * HISTORY);
    let histHead = 0, histClock = 0;

    function resetHistory(i) {
        histλ.fill(λs[i], i * HISTORY, (i + 1) * HISTORY);
        histφ.fill(φs[i], i * HISTORY, (i + 1) * HISTORY);
    }

    // A projection stream applies the projection's clipping (back of the globe, outside the map shape), so a
    // point is visible exactly when the stream emits it.
    let projected = null;
    const sink = {point(x, y) { projected = [x, y]; }};
    let stream = projection.stream(sink);
    function project(λ, φ) {
        projected = null;
        stream.point(λ, φ);
        return projected;
    }

    function isOnScreen(p, view) {
        return p && p[0] >= 0 && p[1] >= 0 && p[0] < view.width && p[1] < view.height;
    }

    /** Places particle i at a random visible location where the grid is defined. */
    function spawn(i, bounds) {
        for (let attempt = 0; attempt < 30; attempt++) {
            const x = bounds.x + Math.random() * bounds.width;
            const y = bounds.y + Math.random() * bounds.height;
            const coord = projection.invert([x, y]);
            if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue;
            const p = project(coord[0], coord[1]);
            // round-trip check: rejects points outside the map shape, where invert returns nonsense
            if (!p || Math.abs(p[0] - x) > 1 || Math.abs(p[1] - y) > 1) continue;
            if (Math.abs(coord[1]) > POLAR_LIMIT || !grid.interpolate(coord[0], coord[1])) continue;
            λs[i] = coord[0];
            φs[i] = coord[1];
            resetHistory(i);
            return;
        }
        // nothing visible found (e.g. zoomed into a hole in the field); park the particle off screen
        λs[i] = Math.random() * 360 - 180;
        φs[i] = Math.random() * 160 - 80;
        resetHistory(i);
    }

    let running = true, moving = false, last = null, frameHandle = null;
    let view = options.getView();
    let bounds = globe.bounds(view);  // computing the bounds is costly for some projections: once per frame
    for (let i = 0; i < count; i++) {
        spawn(i, bounds);
        ages[i] = µ.randomInt(0, MAX_PARTICLE_AGE);
    }

    function step(dtFrames) {
        view = options.getView();
        stream = projection.stream(sink);  // pick up rotation/scale changes made since the last frame
        bounds = globe.bounds(view);
        degreesPerUnit = bounds.height * grid.particles.velocityScale;
        for (const bucket of buckets) bucket.length = 0;
        histClock += dtFrames;
        const record = histClock >= HISTORY_INTERVAL;
        if (record) {
            histClock = 0;
            histHead = (histHead + 1) % HISTORY;
        }

        for (let i = 0; i < count; i++) {
            if (ages[i] > MAX_PARTICLE_AGE) {
                spawn(i, bounds);
                ages[i] = 0;
                continue;
            }
            ages[i] += dtFrames;
            const λ = λs[i], φ = φs[i];
            const wind = grid.interpolate(λ, φ);
            if (!wind) {
                ages[i] = MAX_PARTICLE_AGE + 1;  // escaped the field (e.g. onto land for ocean currents)
                continue;
            }
            const k = degreesPerUnit * dtFrames;
            const φt = φ + wind[1] * k;
            const λt = λ + wind[0] * k / Math.max(Math.cos(φ / DEG), 0.05);
            if (Math.abs(φt) > POLAR_LIMIT) {
                ages[i] = MAX_PARTICLE_AGE + 1;
                continue;
            }
            λs[i] = λt > 180 ? λt - 360 : λt < -180 ? λt + 360 : λt;
            φs[i] = φt;
            if (record) {
                histλ[i * HISTORY + histHead] = λs[i];
                histφ[i * HISTORY + histHead] = φt;
            }
            if (moving) {
                bucketTrail(i, colorStyles.indexFor(wind[2]));
                continue;
            }

            // Both ends are projected with the current projection, so a segment only shows the wind's motion,
            // never the globe's own motion while it is being dragged. Invisible particles keep moving.
            const p0 = project(λ, φ);
            if (!isOnScreen(p0, view)) continue;
            const p1 = project(λs[i], φt);
            if (!isOnScreen(p1, view)) continue;
            if (Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]) > MAX_SEGMENT) continue;
            buckets[colorStyles.indexFor(wind[2])].push(p0[0], p0[1], p1[0], p1[1]);
        }
    }

    /** Adds particle i's remembered trail, projected with the current projection, to the given bucket. */
    function bucketTrail(i, bucketIndex) {
        const bucket = buckets[bucketIndex];
        let prev = project(λs[i], φs[i]);
        if (!isOnScreen(prev, view)) return;
        for (let k = 0; k < HISTORY - 1; k++) {
            const slot = i * HISTORY + (histHead - k + HISTORY) % HISTORY;
            const p = project(histλ[slot], histφ[slot]);
            if (!isOnScreen(p, view) || Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]) > MAX_SEGMENT) return;
            bucket.push(prev[0], prev[1], p[0], p[1]);
            prev = p;
        }
    }

    /**
     * The fade multiplies alpha by ~0.97 per frame, but with 8-bit alpha a faint pixel rounds back to its own value
     * and never disappears. Left alone, those pixels pile up into dots and haze, so fade them out a step at a time.
     */
    let sinceSweep = 0;
    function sweepFaintPixels() {
        const image = g.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
        for (let i = 3; i < data.length; i += 4) {
            const a = data[i];
            if (a !== 0 && a < SWEEP_ALPHA) {
                data[i] = a > SWEEP_STEP ? a - SWEEP_STEP : 0;
            }
        }
        g.putImageData(image, 0, 0);
    }

    function draw(dtFrames) {
        sinceSweep += dtFrames;
        if (sinceSweep >= SWEEP_INTERVAL && !moving) {
            sinceSweep = 0;
            sweepFaintPixels();
        }
        if (moving) {
            // The map moves under the trails, so redraw every trail from its remembered positions.
            g.clearRect(0, 0, canvas.width, canvas.height);
        }
        else {
            // Fade existing particle trails (frame-rate independent).
            const prev = g.globalCompositeOperation;
            g.globalCompositeOperation = "destination-in";
            g.fillStyle = `rgba(0, 0, 0, ${Math.pow(fadeAlpha, dtFrames)})`;
            g.fillRect(0, 0, canvas.width, canvas.height);
            g.globalCompositeOperation = prev;
        }

        g.lineWidth = 1.0;
        buckets.forEach((segments, i) => {
            if (segments.length === 0) return;
            g.beginPath();
            g.strokeStyle = colorStyles[i];
            for (let j = 0; j < segments.length; j += 4) {
                g.moveTo(segments[j], segments[j + 1]);
                g.lineTo(segments[j + 2], segments[j + 3]);
            }
            g.stroke();
        });
    }

    function frame(now) {
        if (!running) return;
        // Clamp so a background tab or a long pause doesn't make particles jump.
        const dtFrames = last === null ? 1 : Math.min((now - last) / BASE_FRAME_MS, 3);
        last = now;
        step(dtFrames);
        draw(dtFrames);
        frameHandle = requestAnimationFrame(frame);
    }
    frameHandle = requestAnimationFrame(frame);

    return {
        /** While moving, trails are redrawn every frame from remembered positions. */
        setMoving(value) {
            moving = value;
        },
        /** Swaps in a new grid of the same kind (e.g. the next forecast hour) without restarting particles. */
        setGrid(newGrid) {
            grid = newGrid;
        },
        stop(clearCanvas) {
            running = false;
            cancelAnimationFrame(frameHandle);
            if (clearCanvas) µ.clearCanvas(canvas);
        },
        get particleCount() {
            return count;
        }
    };
}
