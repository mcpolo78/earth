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

const masks = new Map();  // cache of rendered globe outlines: key -> alpha mask

function maskFor(globe, key, width, height) {
    let mask = masks.get(key);
    if (!mask) {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = globe.defineMask(canvas.getContext("2d"));
        ctx.fillStyle = "rgba(255, 0, 0, 1)";
        ctx.fill();
        mask = ctx.getImageData(0, 0, width, height).data;
        if (masks.size > 8) masks.clear();
        masks.set(key, mask);
    }
    return mask;
}

function render({id, version, projection: p, width, height, step, alpha}) {
    const view = {width, height};
    const globe = globes.get(p.name)(view);
    globe.projection.rotate(p.rotate).scale(p.scale).translate(p.translate);
    // outline of the map (which pixels are on the globe); cached so repeated renders of one view are cheap
    const mask = maskFor(globe, [p.name, p.rotate, p.scale, p.translate, width, height].join("|"), width, height);

    const pixels = new Uint8ClampedArray(width * height * 4);
    if (overlay) {
        const {grid, scale, isVector} = overlay;
        const projection = globe.projection;
        const bounds = globe.bounds(view);
        const point = [0, 0];
        for (let y = bounds.y; y <= bounds.yMax; y += step) {
            for (let x = bounds.x; x <= bounds.xMax; x += step) {
                if (mask[(y * width + x) * 4 + 3] === 0) continue;
                point[0] = x; point[1] = y;
                const coord = projection.invert(point);
                if (!coord || !Number.isFinite(coord[0])) continue;
                const value = grid.interpolate(coord[0], coord[1]);
                const scalar = isVector ? value && value[2] : value;
                if (!µ.isValue(scalar)) continue;
                const color = scale.gradient(scalar, alpha);
                const yEnd = Math.min(y + step, height), xEnd = Math.min(x + step, width);
                for (let yy = y; yy < yEnd; yy++) {
                    let i = (yy * width + x) * 4;
                    for (let xx = x; xx < xEnd; xx++, i += 4) {
                        pixels[i] = color[0];
                        pixels[i + 1] = color[1];
                        pixels[i + 2] = color[2];
                        pixels[i + 3] = color[3];
                    }
                }
            }
        }
    }
    postMessage({type: "rendered", id, version, width, height, step, buffer: pixels.buffer}, [pixels.buffer]);
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
