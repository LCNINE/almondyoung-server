/**
 * 출고 박스의 받는 분 스냅샷(jsonb)에서 현장 화면에 띄울 값만 뽑는다 — 송장 스캔·보충 대기·배치 박스 목록이 같이 쓴다.
 * 의존이 없는 순수 함수라 리더끼리 서로 import 하지 않고 여기서 가져간다(`ShipmentWaybillReader` 는 `WaybillLabelStateReader` 를 주입받는다).
 */

function isRecipientRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 이름은 뒤 절반을 가린다 — 현장 화면에 개인정보를 통째로 띄우지 않는다. */
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  const keep = Math.ceil(trimmed.length / 2);
  return `${trimmed.slice(0, keep)}${'*'.repeat(trimmed.length - keep)}`;
}

/** jsonb 스냅샷에서 이름만 안전하게 뽑는다 — `as` 캐스팅 없이 좁힌다. */
export function readRecipientName(snapshot: unknown): string {
  if (!isRecipientRecord(snapshot)) return '';
  const { recipientName } = snapshot;
  return typeof recipientName === 'string' ? recipientName : '';
}

/** 배송메모만 — 공동현관 비밀번호는 현장 화면에 띄우지 않는다(송장 템플릿만 섞는다). */
export function readDeliveryNote(snapshot: unknown): string | null {
  if (!isRecipientRecord(snapshot)) return null;
  const { deliveryNote } = snapshot;
  if (typeof deliveryNote !== 'string') return null;
  const trimmed = deliveryNote.trim();
  return trimmed ? trimmed : null;
}
