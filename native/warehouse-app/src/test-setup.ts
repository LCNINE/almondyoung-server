import '@testing-library/jest-dom';

// setup 파일은 per-file 환경 오버라이드와 무관하게 모든 테스트 파일에 대해 실행된다. httpScope.test.ts
// 처럼 `@vitest-environment node` 를 쓰는 파일에서는 window 가 없으므로 그 경우를 견뎌야 한다.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}
