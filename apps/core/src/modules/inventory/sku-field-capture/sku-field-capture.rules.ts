import { authenticatedWarehouseActor, type WarehouseActor } from '../core/services/warehouse-operation-contract';

export { normalizePositionCode } from './position-code';

export const MIN_REFERENCE_PHOTOS = 3;
export const MAX_PACKAGE_MM = 5000;
export const MAX_PACKAGE_G = 100_000;

export const FIELD_CAPTURE_BARCODE_STATUSES = ['scanned', 'no_manufacturer', 'none'] as const;
export type FieldCaptureBarcodeStatus = (typeof FIELD_CAPTURE_BARCODE_STATUSES)[number];

export const FIELD_CAPTURE_LIST_WHO = ['mine', 'all'] as const;
export type FieldCaptureListWho = (typeof FIELD_CAPTURE_LIST_WHO)[number];

/** 작업 기록 조회 조건. from·to 는 KST 날짜(YYYY-MM-DD, 양끝 포함), q 는 상품명·코드·선반 부분일치, offset 은 앞에서 받은 개수. */
export type FieldCaptureListFilter = {
  who: FieldCaptureListWho;
  from?: string;
  to?: string;
  q?: string;
  offset?: number;
};

/** 사진 모아보기 조건. from·to 는 찍은 날(KST), q 는 상품명·코드·선반·찍은 사람 부분일치, before 는 이전 페이지 마지막 사진 id. */
export type FieldCapturePhotoFilter = Omit<FieldCaptureListFilter, 'who' | 'offset'> & { before?: string };

/** ILIKE 패턴에서 %·_·\ 를 글자 그대로 찾게 */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type FieldCaptureActor = { workerId: string; workerLabel: string };

export function fieldCaptureActorOf(
  user: NonNullable<WarehouseActor> & { email?: string; login_id?: string; name?: string },
): FieldCaptureActor {
  const workerId = authenticatedWarehouseActor(user);
  // name 은 user-service 가 토큰에 싣는 실명(users.username). 옛 토큰엔 없어 아이디로 물러선다
  return { workerId, workerLabel: user.name || user.login_id || user.email || workerId };
}

/** 실측 대상이 아닌 선반 줄. 남은 선반 목록과 줄 요약에서 뺀다. */
export const FIELD_CAPTURE_EXCLUDED_ROWS: readonly string[] = ['T'];

const SHELF_CODE = /^([A-Z]{1,2})-(\d+)-\d+$/;

/** 위치 코드의 줄과 선반. A-08-36 → 줄 A · 선반 A-08. 꼴이 다르거나 위치가 없으면 둘 다 null. */
export function shelfOf(positionCode: string | null): { row: string | null; shelf: string | null } {
  const m = positionCode?.match(SHELF_CODE);
  if (!m) return { row: null, shelf: null };

  return { row: m[1], shelf: `${m[1]}-${m[2]}` };
}

export type RemainingSource = {
  skuId: string;
  code: string;
  name: string;
  positionCode: string | null;
  qty: number;
  captured: boolean;
};

export type RemainingRow = { row: string; completed: number; remaining: number };
export type RemainingItem = Omit<RemainingSource, 'captured'> & { row: string | null; shelf: string | null };

const byRow = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

/** 줄마다 완료·남은 수와, 제외 줄을 뺀 미완료 상품(줄 → 위치 → 코드 순, 꼴이 다른 위치는 맨 뒤). */
export function summarizeRemaining(sources: RemainingSource[]): { rows: RemainingRow[]; items: RemainingItem[] } {
  const stats = new Map<string, RemainingRow>();
  const items: RemainingItem[] = [];

  for (const { captured, ...s } of sources) {
    const { row, shelf } = shelfOf(s.positionCode);
    if (row && FIELD_CAPTURE_EXCLUDED_ROWS.includes(row)) continue;

    if (row) {
      const stat = stats.get(row) ?? { row, completed: 0, remaining: 0 };
      if (captured) stat.completed++;
      else stat.remaining++;
      stats.set(row, stat);
    }

    if (!captured) items.push({ ...s, row, shelf });
  }

  items.sort((a, b) => {
    if (!a.row || !b.row) return Number(!a.row) - Number(!b.row) || a.code.localeCompare(b.code);

    return (
      byRow(a.row, b.row) || (a.positionCode ?? '').localeCompare(b.positionCode ?? '') || a.code.localeCompare(b.code)
    );
  });

  return { rows: [...stats.values()].sort((a, b) => byRow(a.row, b.row)), items };
}
