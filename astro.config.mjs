// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkGfm from 'remark-gfm';

// https://astro.build/config
export default defineConfig({
  site: 'https://gsh150801.github.io',
  base: '/tech-blog',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/404') && !page.includes('/posts/editor') && !page.includes('/series/manage'),
    }),
  ],
  markdown: {
    remarkPlugins: [remarkGfm],
    shikiConfig: {
      themes: {
        light: 'vitesse-light',
        dark: 'vitesse-dark',
      },
      wrap: true,
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
