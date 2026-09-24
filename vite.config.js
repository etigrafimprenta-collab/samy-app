import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import path from 'path'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: 'src',
  // BUG REAL encontrado probando el walkthrough manual: con `root: 'src'`
  // y sin `envDir` explícito, Vite busca los .env DENTRO de src/ (envDir
  // por defecto = root). Los archivos .env.emulator/.env.staging siempre
  // vivieron en la raíz del proyecto (junto a vite.config.js), así que
  // VITE_USE_FIREBASE_EMULATOR/VITE_USE_STAGING nunca se cargaban —
  // `npm run dev:emulator`/`dev:staging` caían en silencio a la config
  // real de producción (samy-fidabel) sin ningún error visible. No afecta
  // a `npm run dev`/`npm run build` normales (sin .env en la raíz, ambas
  // rutas ya resolvían a producción de todos modos).
  envDir: projectRoot,
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
})