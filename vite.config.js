import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
    server: { port: 8080 },
    preview: { port: 8080 },
    build: {
        target: "es2022",
        rollupOptions: {
            input: {
                main: resolve(import.meta.dirname, "index.html"),
                jp: resolve(import.meta.dirname, "jp/index.html")
            }
        }
    },
    test: { environment: "node" }
});
