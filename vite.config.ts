import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        ui: './ui.html',
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      }
    },
  },
});
