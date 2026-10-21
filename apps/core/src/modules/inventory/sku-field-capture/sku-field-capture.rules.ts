import { authenticatedWarehouseActor, type WarehouseActor } from '../core/services/warehouse-operation-contract';

export { normalizePositionCode } from './position-code';

export const MIN_REFERENCE_PHOTOS = 3;
export const MAX_PACKAGE_MM = 5000;

export const FIELD_CAPTURE_BARCODE_STATUSES = ['scanned', 'no_manufacturer', 'none'] as const;
export type FieldCaptureBarcodeStatus = (typeof FIELD_CAPTURE_BARCODE_STATUSES)[number];

export const FIELD_CAPTURE_LIST_WHO = ['mine', 'all'] as const;
export type FieldCaptureListWho = (typeof FIELD_CAPTURE_LIST_WHO)[number];

/** 작업 기록 조회 조건. from·to 는 KST 날짜(YYYY-MM-DD, 양끝 포함), q 는 상품명·코드·선반 부분일치. */
export type FieldCaptureListFilter = { who: FieldCaptureListWho; from?: string; to?: string; q?: string };

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
