import { defineConfig } from "vitest/config"

// Expo/React Native 앱이지만 이 프로젝트에서 vitest 로 테스트하는 대상은
// 순수 로직(.ts) 모듈뿐이다 — 네이티브 모듈은 주입받아 사용하고 직접
// import 하지 않으므로 jsdom 같은 RN/브라우저 환경 목이 필요 없다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
