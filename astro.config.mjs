import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.SITE_URL || 'https://alsobuilt.pages.dev',
  output: 'static',
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()]
  }
});
