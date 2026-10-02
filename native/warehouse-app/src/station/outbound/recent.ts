export type RecentKind = 'waybill' | 'scan' | 'shipped' | 'printed' | 'error';

export interface RecentEntry {
  id: number;
  at: number;
  kind: RecentKind;
  /** 송장번호(waybill·shipped·printed), 상품 이름(scan), 거절된 코드나 사유(error) */
  text: string;
  qty?: number;
}

/** 최근 스캔 줄 수(목업 ②) */
export const RECENT_LIMIT = 8;

let nextId = 0;

/** 새것이 위. 화면 상태로만 둔다 — 탭을 옮기면 사라진다(계획이 정함) */
export function pushRecent(list: readonly RecentEntry[], entry: Omit<RecentEntry, 'id'>): RecentEntry[] {
  nextId += 1;
  return [{ ...entry, id: nextId }, ...list].slice(0, RECENT_LIMIT);
}

/** 기기 시계 HH:MM:SS */
export function clockOf(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
