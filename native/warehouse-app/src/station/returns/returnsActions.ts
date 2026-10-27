import type { ActionSpec } from '../actions';

/**
 * F7 반품의 액션. 화면은 상태마다 일부만 선언한다 — 한 층에 F10·Escape 가 둘씩 오지 않게
 * (목록: 검색·검색 지우기, 소포 세기: 도착 확정·목록, 검수: 검수 확정·목록).
 */
export const RETURNS_ACTIONS = {
  search: { id: 'returns-search', key: 'F9', label: '검색' },
  clear: { id: 'returns-clear', key: 'Escape', label: '검색 지우기' },
  confirmArrival: { id: 'returns-arrival', key: 'F10', label: '도착 확정' },
  confirmInspection: { id: 'returns-inspection', key: 'F10', label: '검수 확정' },
  back: { id: 'returns-back', key: 'Escape', label: '목록' },
} as const satisfies Record<string, ActionSpec>;
