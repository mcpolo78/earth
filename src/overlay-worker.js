/**
 * overlay-worker - renders the colored data overlay off the main thread.
 *
 * The main thread sends the raw files of the overlay product once per data change, then asks for renders of
 * the current projection. Each render inverts every (step x step) block of pixels to a longitude/latitude,
 * interpolates the grid there and colors it. Coarse steps are used while the globe moves (a few ms), and a fine
 * step once it stops, so the overlay follows the globe without blocking the animation.
 */
import { globes } from "./globes.js";
import { productsFor, buildGrid } from "./products.js";
import * as µ from "./micro.js";

let overlay = null;  // {grid, scale, isVector}
let gridVersion = 0;

async function setGrid({attr, index, files, version}) {
    const candidates = (await Promise.all(productsFor(attr))).filter(µ.isValue);
    const product = candidates[index];
    if (version !== gridVersion) return;  // a newer grid arrived while this one was being prepared
    overlay = product ? {
        grid: buildGrid(product.builder(...files)),
        scale: product.scale,
        isVector: product.field === "vector"
    } : null;
}

const masks = new Map();  // cache of rendered globe outlines: key -> {canvas}

function maskFor(globe, key, width, height) {
    let mask = masks.get(key);
    if (!mask) {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = globe.defineMask(canvas.getContext("2d"));
        ctx.fillStyle = "rgba(255, 0, 0, 1)";
        ctx.fill();
        mask = {canvas};
        if (masks.size > 8) masks.clear();
        masks.set(key, mask);
    }
    return mask;
}

let output = null;  // full-size canvas the samples are scaled into

/**
 * Samples the grid once per (step x step) block into a small image, then scales that image up with smoothing
 * and cuts it to the globe's outline. Coarse steps therefore look soft instead of blocky while the globe moves.
 */
function render({id, version, projection: p, width, height, step, alpha}) {
    const view = {width, height};
    const globe = globes.get(p.name)(view);
    globe.projection.rotate(p.rotate).scale(p.scale).translate(p.translate);
    // outline of the map (which pixels are on the globe); cached so repeated renders of one view are cheap
    const mask = maskFor(globe, [p.name, p.rotate, p.scale, p.translate, width, height].join("|"), width, height);

    const bounds = globe.bounds(view);
    const cols = Math.max(1, Math.ceil((bounds.xMax - bounds.x + 1) / step));
    const rows = Math.max(1, Math.ceil((bounds.yMax - bounds.y + 1) / step));
    const samples = new Uint8ClampedArray(cols * rows * 4);
    if (overlay) {
        const {grid, scale, isVector} = overlay;
        const projection = globe.projection;
        const point = [0, 0], half = step / 2;
        for (let r = 0, i = 0; r < rows; r++) {
            const y = bounds.y + r * step + half;
            for (let c = 0; c < cols; c++, i += 4) {
                const x = bounds.x + c * step + half;
                point[0] = x; point[1] = y;
                const coord = projection.invert(point);
                if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue;
                // samples just outside the outline are kept (when the projection can invert them) so the edge
                // stays sharp once the image is cut to the outline
                const value = grid.interpolate(coord[0], coord[1]);
                const scalar = isVector ? value && value[2] : value;
                if (!µ.isValue(scalar)) continue;
                const color = scale.gradient(scalar, alpha);
                samples[i] = color[0];
                samples[i + 1] = color[1];
                samples[i + 2] = color[2];
                samples[i + 3] = color[3];
            }
        }
    }

    if (!output || output.width !== width || output.height !== height) output = new OffscreenCanvas(width, height);
    const ctx = output.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    if (overlay) {
        const small = new OffscreenCanvas(cols, rows);
        small.getContext("2d").putImageData(new ImageData(samples, cols, rows), 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // pixel c covers [x + c*step, x + (c+1)*step), so its center lands on the sampled point
        ctx.drawImage(small, bounds.x, bounds.y, cols * step, rows * step);
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(mask.canvas, 0, 0);
        ctx.globalCompositeOperation = "source-over";
    }
    const bitmap = output.transferToImageBitmap();
    postMessage({type: "rendered", id, version, width, height, step, bitmap}, [bitmap]);
}

self.onmessage = async ({data}) => {
    try {
        switch (data.type) {
            case "grid":
                gridVersion = data.version;
                await setGrid(data);
                postMessage({type: "grid-ready", version: data.version});
                break;
            case "render":
                render(data);
                break;
        }
    } catch (e) {
        postMessage({type: "error", id: data.id, message: String(e && e.stack || e)});
    }
};
