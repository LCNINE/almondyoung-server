import type {
  FulfillmentShippingAddress,
  ReviseShipmentRecipientRequest,
} from '@/lib/types/dto/fulfillment';

/**
 * 수령인 정정 폼의 상태. 공동현관 비번은 화면에서는 수령인 필드와 나란히 입력받지만
 * 배송 지시가 아니라 크리덴셜이라 recipientSnapshot 밖으로 나간다 — 스냅샷에 섞이면
 * 합배송 그룹핑 키와 송장 멱등 해시가 오염된다.
 */
export type RecipientForm = {
  recipientName: string;
  phone: string;
  postalCode: string;
  roadAddress: string;
  detailAddress: string;
  deliveryNote: string;
  entrancePassword: string;
};

/** 비워 둬도 되는 입력. 배송 메모는 선택 정보, 비번은 "안 건드림"의 표현이다. */
const OPTIONAL_FIELDS: ReadonlySet<keyof RecipientForm> = new Set([
  'deliveryNote',
  'entrancePassword',
]);

export const RECIPIENT_FIELDS: ReadonlyArray<{
  key: keyof RecipientForm;
  label: string;
  placeholder?: string;
  type?: 'text' | 'password';
  autoComplete?: string;
}> = [
  { key: 'recipientName', label: '수령인' },
  { key: 'phone', label: '전화번호' },
  { key: 'postalCode', label: '우편번호' },
  { key: 'roadAddress', label: '도로명 주소' },
  { key: 'detailAddress', label: '상세 주소' },
  { key: 'deliveryNote', label: '배송 메모' },
  {
    key: 'entrancePassword',
    label: '공동현관 비밀번호',
    // 현재 값은 응답에 실리지 않으므로(크리덴셜) 빈 칸이 "비번 없음"이 아니다.
    placeholder: '비워 두면 기존 비번을 그대로 둡니다',
    // 크리덴셜이다. 어깨너머로 읽히지 않게 가리고, 브라우저가 저장하지 않게 막는다.
    type: 'password',
    autoComplete: 'off',
  },
];

export function missingRecipientFields(
  form: RecipientForm
): Array<keyof RecipientForm> {
  return (Object.keys(form) as Array<keyof RecipientForm>).filter(
    (key) => !OPTIONAL_FIELDS.has(key) && !form[key].trim()
  );
}

/** 이 폼이 아는 배송지 키. 실제 스냅샷은 이보다 넓을 수 있다 (`personalCustomsCode` 등). */
const SNAPSHOT_FIELDS = [
  'recipientName',
  'phone',
  'postalCode',
  'roadAddress',
  'detailAddress',
  'deliveryNote',
] as const;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 폼이 아는 6개 키만 놓고 원본 스냅샷과 비교한다. 모르는 키(통관부호 등)는 비교에서
 * 빼야 한다 — 그래야 "주소는 그대로"라는 판정이 성립하고, 스냅샷을 안 보내 그 키들이
 * 살아남는다. 저장된 값의 `null` 은 빈 값과 같게 본다 (core `sameJson` 과 같은 규칙).
 */
function addressUnchanged(
  next: FulfillmentShippingAddress,
  current: unknown
): boolean {
  const stored =
    current && typeof current === 'object'
      ? (current as Record<string, unknown>)
      : {};
  return SNAPSHOT_FIELDS.every((key) => text(next[key]) === text(stored[key]));
}

export function buildRecipientRevisionPayload(
  form: RecipientForm,
  command: {
    expectedManifestVersion: number;
    reason: string;
    csCaseId?: string;
    note?: string;
    /** shipment.recipientSnapshot 원본. 폼이 모르는 키까지 들어 있을 수 있다. */
    currentSnapshot: unknown;
  }
): ReviseShipmentRecipientRequest {
  const deliveryNote = form.deliveryNote.trim();
  const entrancePassword = form.entrancePassword.trim();
  const csCaseId = command.csCaseId?.trim() ?? '';
  const note = command.note?.trim() ?? '';

  const recipientSnapshot: FulfillmentShippingAddress = {
    recipientName: form.recipientName.trim(),
    phone: form.phone.trim(),
    postalCode: form.postalCode.trim(),
    roadAddress: form.roadAddress.trim(),
    detailAddress: form.detailAddress.trim(),
    ...(deliveryNote ? { deliveryNote } : {}),
  };

  return {
    expectedManifestVersion: command.expectedManifestVersion,
    // 안 바뀐 주소는 되보내지 않는다. 6키를 되보내면 서버 whitelist 가 통관부호를
    // 떨어뜨리고(데이터 손실), core 는 스냅샷 변경으로 읽어 manifestVersion 을 올린다.
    ...(addressUnchanged(recipientSnapshot, command.currentSnapshot)
      ? {}
      : { recipientSnapshot }),
    // 빈 값은 "비번을 안 건드린다"는 뜻이다. core 는 이 키가 없으면 기존 비번을 유지한다.
    ...(entrancePassword ? { entrancePassword } : {}),
    reason: command.reason.trim(),
    ...(csCaseId ? { csCaseId } : {}),
    ...(note ? { note } : {}),
  };
}
