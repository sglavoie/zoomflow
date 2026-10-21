import { defineConfig } from 'vite';
import { aiPlugin } from './ai-server.ts';

// A relative base lets the static build run from any path, such as a GitHub Pages project site.
export default defineConfig({ base: './', plugins: [aiPlugin()] });
