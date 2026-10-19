import { defineConfig } from 'vite';
import { aiPlugin } from './ai-server.ts';

export default defineConfig({ plugins: [aiPlugin()] });
