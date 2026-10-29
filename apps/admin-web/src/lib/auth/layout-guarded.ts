/** 하위 페이지가 클라이언트 컴포넌트라 레이아웃이 가드하는 경로 → `app/` 기준 레이아웃 파일. */
export const LAYOUT_GUARDED: Readonly<Record<string, string>> = {
  '/mobile': 'mobile/layout.tsx',
  '/customer-window/[id]': 'customer-window/[id]/layout.tsx',
  '/attendance': 'attendance/layout.tsx',
  '/company/attendance': '(admin)/company/attendance/layout.tsx',
};
