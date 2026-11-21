/**
 * globe3d - a WebGL globe (three.js) showing the same weather layers as the 2D maps.
 *
 * The data is drawn into equirectangular textures wrapped around a sphere:
 *   - a base texture: dark background, color overlay, graticule and coastlines, redrawn when the data changes;
 *   - a particle texture: the usual particle animation (src/particles.js) running on an equirectangular "globe",
 *     uploaded every frame and blended over the base.
 * Because the particles live in texture space, turning or zooming the globe never disturbs their trails.
 *
 * This module is loaded on demand (dynamic import) so three.js is only downloaded when the 3D view is used.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as d3 from "d3";
import { createAnimator } from "./particles.js";
import * as µ from "./micro.js";

const TEX_WIDTH = 2048, TEX_HEIGHT = 1024;          // particle and line texture size
const OVERLAY_WIDTH = 1024, OVERLAY_HEIGHT = 512;   // color overlay resolution (smoothed when scaled up)
const OVERLAY_ALPHA = 0.55;
const PARTICLE_COUNT = 16000;
const BACKGROUND = "#202024";

/** A stand-in for a globes.js globe: an equirectangular projection filling the texture. */
function textureGlobe() {
    const projection = d3.geoEquirectangular()
        .scale(TEX_WIDTH / (2 * Math.PI))
        .translate([TEX_WIDTH / 2, TEX_HEIGHT / 2])
        .precision(0.1);
    const bounds = {x: 0, y: 0, xMax: TEX_WIDTH - 1, yMax: TEX_HEIGHT - 1, width: TEX_WIDTH, height: TEX_HEIGHT};
    return {projection, bounds: () => bounds};
}

/** @returns {THREE.Vector3} the unit vector pointing at [λ, φ] in the sphere's texture mapping. */
function toVector(λ, φ, radius = 1) {
    // three.js SphereGeometry puts u = 0 (λ = -180°) on -x and u = 0.5 (λ = 0°) on +x; λ = 90° is on -z.
    const lam = λ * Math.PI / 180, phi = φ * Math.PI / 180;
    return new THREE.Vector3(Math.cos(phi) * Math.cos(lam), Math.sin(phi), -Math.cos(phi) * Math.sin(lam))
        .multiplyScalar(radius);
}

const earthVertex = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }`;

// Texture plus a soft limb darkening, so the sphere reads as round without hiding the data.
const earthFragment = `
    uniform sampler2D map;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        vec4 color = texture2D(map, vUv);
        float facing = clamp(dot(vNormal, vView), 0.0, 1.0);
        gl_FragColor = vec4(color.rgb * (0.45 + 0.55 * pow(facing, 0.6)), 1.0);
        #include <colorspace_fragment>
    }`;

const atmosphereVertex = `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }`;

const atmosphereFragment = `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
        // Back faces of a slightly larger sphere: zero at its silhouette, brightest against the Earth's limb.
        float depth = -dot(vNormal, vView);
        float glow = pow(smoothstep(0.0, 0.5, depth), 2.0) * 0.7;
        gl_FragColor = vec4(0.35, 0.6, 1.0, 1.0) * glow;
    }`;

function starfield(count) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 20);
        positions.set([v.x, v.y, v.z], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
        color: 0x8090a0, size: 0.08, sizeAttenuation: true, transparent: true, opacity: 0.7
    }));
}

/**
 * @param container element that receives the WebGL canvas (made to fill it)
 * @param options {onClick(coord)} called with [λ, φ] when the globe is clicked without dragging,
 *                {start} the [λ, φ] the camera first looks at
 */
export function createGlobe3D(container, options = {}) {
    const canvas = document.createElement("canvas");
    canvas.id = "webgl-globe";
    container.prepend(canvas);  // before the menu, so the menu stays on top

    const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000005);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.15;
    controls.maxDistance = 10;
    controls.zoomSpeed = 0.8;

    // Base texture: background, overlay, graticule, coastlines.
    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = TEX_WIDTH;
    baseCanvas.height = TEX_HEIGHT;
    const baseTexture = new THREE.CanvasTexture(baseCanvas);
    baseTexture.colorSpace = THREE.SRGBColorSpace;
    baseTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = OVERLAY_WIDTH;
    overlayCanvas.height = OVERLAY_HEIGHT;

    // Particle texture: drawn by the 2D particle animator, blended additively over the base.
    const particleCanvas = document.createElement("canvas");
    particleCanvas.width = TEX_WIDTH;
    particleCanvas.height = TEX_HEIGHT;
    const particleTexture = new THREE.CanvasTexture(particleCanvas);
    particleTexture.colorSpace = THREE.SRGBColorSpace;
    particleTexture.anisotropy = baseTexture.anisotropy;

    const sphere = new THREE.SphereGeometry(1, 192, 96);
    const earth = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
        uniforms: {map: {value: baseTexture}},
        vertexShader: earthVertex,
        fragmentShader: earthFragment
    }));
    const particles = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({
        map: particleTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    particles.scale.setScalar(1.001);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.12, 96, 48), new THREE.ShaderMaterial({
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    }));
    const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.012, 0.018, 32),
        new THREE.MeshBasicMaterial({color: 0x00ff00, side: THREE.DoubleSide, transparent: true, depthWrite: false}));
    marker.visible = false;
    const start = options.start || [0, 20];
    camera.position.copy(toVector(start[0], start[1], 3.6));
    scene.add(starfield(1500), earth, particles, atmosphere, marker);

    const flat = textureGlobe();
    let mesh = null, grids = null, overlayEnabled = true, animator = null;
    let running = false, frameHandle = null;

    function drawBase() {
        const g = baseCanvas.getContext("2d");
        g.globalAlpha = 1;
        g.fillStyle = BACKGROUND;
        g.fillRect(0, 0, TEX_WIDTH, TEX_HEIGHT);
        if (grids && overlayEnabled) {
            g.globalAlpha = OVERLAY_ALPHA;
            g.imageSmoothingEnabled = true;
            g.drawImage(overlayCanvas, 0, 0, TEX_WIDTH, TEX_HEIGHT);
            g.globalAlpha = 1;
        }
        const path = d3.geoPath(flat.projection, g);
        g.lineWidth = 1;
        g.strokeStyle = "rgba(255, 255, 255, 0.12)";
        g.beginPath();
        path(d3.geoGraticule()());
        g.stroke();
        if (mesh) {
            g.lineWidth = 1.6;
            g.strokeStyle = "rgba(255, 255, 255, 0.85)";
            g.beginPath();
            path(mesh.coastHi);
            g.stroke();
            g.lineWidth = 1;
            g.strokeStyle = "rgba(255, 255, 255, 0.6)";
            g.beginPath();
            path(mesh.lakesHi);
            g.stroke();
        }
        baseTexture.needsUpdate = true;
    }

    /** Colors the overlay grid into the overlay canvas, one sample per pixel. */
    function drawOverlay() {
        const grid = grids.overlayGrid, scale = grid.scale;
        const g = overlayCanvas.getContext("2d");
        const image = g.createImageData(OVERLAY_WIDTH, OVERLAY_HEIGHT), data = image.data;
        for (let y = 0, p = 0; y < OVERLAY_HEIGHT; y++) {
            const φ = 90 - (y + 0.5) * 180 / OVERLAY_HEIGHT;
            for (let x = 0; x < OVERLAY_WIDTH; x++, p += 4) {
                const λ = -180 + (x + 0.5) * 360 / OVERLAY_WIDTH;
                const value = grid.interpolate(λ, φ);
                if (!µ.isValue(value)) continue;
                const scalar = grid.field === "vector" ? value[2] : value;
                if (!µ.isValue(scalar)) continue;
                const color = scale.gradient(scalar, 255);
                data[p] = color[0];
                data[p + 1] = color[1];
                data[p + 2] = color[2];
                data[p + 3] = color[3];
            }
        }
        g.putImageData(image, 0, 0);
    }

    function startParticles() {
        if (animator) animator.stop(true);
        animator = null;
        µ.clearCanvas(particleCanvas);
        if (!running || !grids || !grids.primaryGrid.particles) return;
        animator = createAnimator(particleCanvas, flat, grids.primaryGrid, {
            particleCount: PARTICLE_COUNT,
            getView: () => ({width: TEX_WIDTH, height: TEX_HEIGHT})
        });
        animator.type = grids.primaryGrid.type;
    }

    function resize() {
        const width = window.innerWidth, height = window.innerHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function frame() {
        if (!running) return;
        controls.rotateSpeed = 0.25 + 0.35 * Math.min(1, (camera.position.length() - 1) / 3);  // slower up close
        controls.update();
        if (animator) particleTexture.needsUpdate = true;
        renderer.render(scene, camera);
        frameHandle = requestAnimationFrame(frame);
    }

    // A click is a press and release without dragging.
    let down = null;
    canvas.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
    canvas.addEventListener("pointerup", e => {
        if (!down || Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 4) return;
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            (e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObject(earth)[0];
        if (hit && options.onClick) {
            options.onClick([hit.uv.x * 360 - 180, hit.uv.y * 180 - 90]);
        }
    });
    window.addEventListener("resize", () => running && resize());

    return {
        canvas,
        /** Shows the globe and starts rendering. */
        show() {
            if (running) return;
            running = true;
            canvas.style.display = "";
            resize();
            startParticles();
            frame();
        },
        /** Hides the globe and stops all work. */
        hide() {
            running = false;
            cancelAnimationFrame(frameHandle);
            canvas.style.display = "none";
            if (animator) animator.stop(true);
            animator = null;
        },
        get visible() {
            return running;
        },
        setMesh(value) {
            if (value === mesh) return;
            mesh = value;
            drawBase();
        },
        setGrids(value) {
            if (value === grids) return;
            const sameKind = grids && value && grids.primaryGrid.type === value.primaryGrid.type;
            grids = value;
            if (grids) drawOverlay();
            drawBase();
            if (sameKind && animator) {
                animator.setGrid(grids.primaryGrid);
            }
            else {
                startParticles();
            }
        },
        setOverlayEnabled(value) {
            if (value === overlayEnabled) return;
            overlayEnabled = value;
            drawBase();
        },
        /** Points the camera at [λ, φ], keeping its distance. */
        lookAt(coord) {
            camera.position.copy(toVector(coord[0], coord[1], camera.position.length() || 4));
            controls.update();
        },
        setMarker(coord) {
            marker.visible = !!coord;
            if (coord) {
                const position = toVector(coord[0], coord[1], 1.003);
                marker.position.copy(position);
                marker.lookAt(position.clone().multiplyScalar(2));
            }
        },
        get particleCount() {
            return animator ? animator.particleCount : 0;
        }
    };
}
