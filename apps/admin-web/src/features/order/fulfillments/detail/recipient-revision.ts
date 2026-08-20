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
  },
];

export function missingRecipientFields(
  form: RecipientForm
): Array<keyof RecipientForm> {
  return (Object.keys(form) as Array<keyof RecipientForm>).filter(
    (key) => !OPTIONAL_FIELDS.has(key) && !form[key].trim()
  );
}

export function buildRecipientRevisionPayload(
  form: RecipientForm,
  command: {
    expectedManifestVersion: number;
    reason: string;
    csCaseId?: string;
    note?: string;
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
    recipientSnapshot,
    // 빈 값은 "비번을 안 건드린다"는 뜻이다. core 는 이 키가 없으면 기존 비번을 유지한다.
    ...(entrancePassword ? { entrancePassword } : {}),
    reason: command.reason.trim(),
    ...(csCaseId ? { csCaseId } : {}),
    ...(note ? { note } : {}),
  };
}
