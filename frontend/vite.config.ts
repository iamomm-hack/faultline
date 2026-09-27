import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      '@faultline/sdk': fileURLToPath(
        new URL('./src/protocol/sdk-browser.ts', import.meta.url),
      ),
      '@faultline/idl': fileURLToPath(
        new URL('../packages/faultline-idl/src/index.ts', import.meta.url),
      ),
      '@solana/web3.js': fileURLToPath(
        new URL(
          './node_modules/@solana/web3.js/lib/index.browser.esm.js',
          import.meta.url,
        ),
      ),
      'node:crypto': fileURLToPath(
        new URL('./src/protocol/browser-crypto.ts', import.meta.url),
      ),
    },
  },
  optimizeDeps: { exclude: ['@faultline/sdk', '@faultline/idl'] },
  server: { host: 'localhost', port: 3000, strictPort: true },
});
