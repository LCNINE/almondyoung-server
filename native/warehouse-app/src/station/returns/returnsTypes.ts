import type { ReturnView } from '../../domains/customer-returns/types';

/** 화면 상태 — 목록 → (열기) → 소포 세기 또는 검수(N8) */
export type ReturnsView =
  | { kind: 'list' }
  /** firstScan — 목록에서 스캐너로 연 그 상품 바코드. 소포 세기가 그 한 개를 센다 */
  | { kind: 'receive'; view: ReturnView; firstScan?: string }
  | { kind: 'inspect'; view: ReturnView };

/** 목록 위 한 줄 — error 는 오류음과 함께 */
export interface ReturnsNotice {
  text: string;
  tone: 'error' | 'info';
}
