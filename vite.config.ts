import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages serviert das Projekt unter /<repo>/, nicht im Wurzelverzeichnis.
  // Ohne diesen Präfix laufen alle Asset-Pfade und die fetch()-Aufrufe auf
  // public/data/* ins Leere.
  //
  // Die Unterscheidung läuft über `mode`, nicht über `command`: `vite preview`
  // meldet command "serve" und würde ohne Präfix ausliefern, obwohl es das
  // fertige Bündel serviert — der Produktionstest wäre damit wertlos. `mode` ist
  // bei build und preview "production" und nur im Dev-Server "development".
  base: mode === 'production' ? '/hideAndSeek/' : '/',
  plugins: [vue()],
}))
