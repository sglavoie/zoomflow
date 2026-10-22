import { defineConfig, type Plugin } from 'vite';
import { aiPlugin } from './ai-server.ts';

/** The dev server inlines each prebundled dependency's source map as base64, which turned
 * D2's 11 MB module into 27 MB of JavaScript to parse on every page load. Link the map
 * file Vite already serves instead, so DevTools still loads it, but only on demand. */
function lazyDependencySourceMaps(): Plugin {
  return {
    name: 'zoomflow-lazy-dependency-sourcemaps',
    apply: 'serve',
    transform(code, id) {
      const file = /\/\.vite\/deps\/([^/?]+\.js)(\?|$)/.exec(id)?.[1];
      if (file) return { code: `${code}\n//# sourceMappingURL=${file}.map\n`, map: { mappings: '' } };
    },
  };
}

// A relative base lets the static build run from any path, such as a GitHub Pages project site.
// Browser tests intercept the lazily loaded D2 module, so give its chunk a stable name.
export default defineConfig({
  base: './',
  plugins: [aiPlugin(), lazyDependencySourceMaps()],
  build: { rolldownOptions: { output: { manualChunks: (id) => (id.includes('/@d2lang/d2/') ? 'd2' : undefined) } } },
});
