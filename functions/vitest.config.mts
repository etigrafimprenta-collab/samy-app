import { defineConfig } from "vitest/config";

// Tests viven en test/, fuera de src/ (rootDir de tsconfig.json), a
// propósito: así `npm run build` (tsc, lo que corre el predeploy de
// Firebase) nunca los compila ni necesita vitest instalado en el árbol de
// deploy — vitest solo hace falta para correr `npm test` en desarrollo.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
