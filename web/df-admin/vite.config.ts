import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Vite dev 프록시는 사용하지 않음.
    // 개발 환경에서는 client.ts가 localhost:{port}로 직접 호출하고,
    // 각 백엔드 서비스의 CORS 설정(origin: true)이 이를 허용함.
  },
})
