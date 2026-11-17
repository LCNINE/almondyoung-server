/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 관리자 웹과 같은 권한 목록 원본을 쓴다. 이 폴더는 밖을 import 하지 않는다.
const permissionCatalog = fileURLToPath(
  new URL('../../libs/authorization/src/permissions', import.meta.url)
);

// Fixed port + no clearScreen so the Tauri CLI can attach later (on the dev box).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@permission-catalog': `${permissionCatalog}/index.ts` },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: ['.', permissionCatalog] },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
