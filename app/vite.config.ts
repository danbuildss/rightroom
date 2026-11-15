// Builds the founder app (app/) into site/app/, served by the Worker as static files.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "/app/",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: "../site/app",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
});
