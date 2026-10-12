import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: "src/android",
  plugins: [
    react(),
    {
      name: "reject-desktop-runtime",
      enforce: "pre",
      resolveId(id) {
        if (id === "electron" || id.startsWith("node:")) {
          throw new Error(`Android cannot import desktop runtime module ${id}`);
        }
      },
    },
  ],
  build: { outDir: path.join(root, "dist-android"), emptyOutDir: true },
});
