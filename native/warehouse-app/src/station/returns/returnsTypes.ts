import type { ReturnView } from '../../domains/customer-returns/types';

/** 화면 상태 — 목록 → (열기) → 소포 세기 또는 검수(N8) */
export type ReturnsView = { kind: 'list' } | { kind: 'receive'; view: ReturnView } | { kind: 'inspect'; view: ReturnView };

/** 목록 위 한 줄 — error 는 오류음과 함께 */
export interface ReturnsNotice {
  text: string;
  tone: 'error' | 'info';
}
