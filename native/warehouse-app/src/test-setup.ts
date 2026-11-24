import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { resetRemembered } from './core/design/rememberedState';

afterEach(() => {
  resetRemembered();
});

// setup 파일은 per-file 환경 오버라이드와 무관하게 모든 테스트 파일에 대해 실행된다. httpScope.test.ts
// 처럼 `@vitest-environment node` 를 쓰는 파일에서는 window 가 없으므로 그 경우를 견뎌야 한다.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}

// jsdom 에는 Tauri 가 없어 platform() 이 던진다. 스테이션 판정을 기본으로 부르는 화면(미발송 주문 칸 등)이
// 렌더만 돼도 죽지 않게 핸드헬드로 둔다 — 파일이 자기 vi.mock 을 두면 그쪽이 이긴다.
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'android' }));
