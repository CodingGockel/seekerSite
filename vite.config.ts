import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  /*
   * Relative Asset-Pfade statt eines festen Präfixes.
   *
   * GitHub Pages serviert das Projekt unter /<repo>/, nicht im Wurzelverzeichnis — ohne
   * Präfix laufen alle Asset-Pfade und die fetch()-Aufrufe auf public/data/* ins Leere.
   * Hier stand deshalb der Repo-Name fest verdrahtet, und genau das ist beim Fork
   * gebrochen: das Bündel zeigte weiter auf /hideAndSeek/, während die Seite unter
   * /seekerSite/ lag. Die Konsole meldet das als 404 auf index-*.js und index-*.css.
   *
   * `'./'` löst gegen die Adresse des Dokuments auf und stimmt damit unter jedem
   * Repo-Namen, in jedem Unterverzeichnis und auch im Wurzelverzeichnis (Netlify,
   * Cloudflare Pages). Dasselbe macht `public/manifest.webmanifest` mit `start_url: "."`
   * schon länger — das Bündel folgt jetzt derselben Linie.
   *
   * Tragfähig ist das, weil die App eine einzige Seite ohne Routing ist: es gibt keine
   * tiefen URLs, gegen die „relativ" etwas anderes hiesse als gegen die Startseite.
   */
  base: './',
  plugins: [vue()],
})
