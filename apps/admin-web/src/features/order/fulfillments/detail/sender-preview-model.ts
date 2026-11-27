import type {
  WaybillSenderFieldSource,
  WaybillSenderOrigin,
  WaybillSenderPreview,
} from '@/lib/types/dto/fulfillment';

/** 이름을 장담할 수 없을 때의 문구 — 추측한 이름을 보이지 않는다 */
export const SENDER_UNKNOWN_TEXT = '확인 불가, 발급 전 설정 확인';

const SOURCE_TEXT: Record<
  Exclude<WaybillSenderPreview['source'], 'unknown'>,
  string
> = {
  profile: '배송 프로필',
  default: '기본 송화인으로 대체',
  waybill: '이미 만든 송장 값',
};

const REASON_TEXT: Record<
  NonNullable<WaybillSenderPreview['reason']>,
  string
> = {
  not_found: '상자를 찾지 못했어요',
  carrier_not_configured: '택배사 연동 설정이 비어 있어요',
  profile_incompatible: '상품의 배송 프로필이 서로 달라 확정이 막혀요',
  sender_missing: '보내는 분 이름이 비어 있어요',
  manual_waybill: '수기로 넣은 송장이에요',
};

/** 칸 하나가 확인 불가일 때 — 이름이 확인 불가면 이 칸들은 보이지 않는다 */
export const FIELD_UNKNOWN_TEXT = '확인 불가';

/**
 * 한진 출고 접수와 송장 종이에는 보내는 분 이름·전화·주소만 실린다.
 * 배송 프로필의 반품지 설정은 송장에 실리지 않으므로 값을 보이지 않고 그 사실만 적는다
 */
export const RETURN_ADDRESS_TEXT =
  '송장·한진 접수에 따로 싣지 않아요(배송 프로필의 반품지는 송장에 안 찍혀요)';

const FIELD_SOURCE_TEXT: Record<
  Exclude<WaybillSenderFieldSource, 'unknown'>,
  string
> = {
  profile: '배송 프로필',
  default: '기본값으로 대체',
  waybill: '이미 만든 송장 값',
};

export interface SenderField {
  /** 찍힐 값. 모르면 null */
  text: string | null;
  /** 값 옆 작은 글씨: 출처. 확인 불가면 빈 문자열 */
  note: string;
}

export interface SenderLine {
  key: string;
  /** 찍힐 이름. 모르면 null */
  name: string | null;
  /** 이름 옆 작은 글씨: 출처나 확인 불가 사유 */
  note: string;
  unknown: boolean;
  /** 보내는 분 전화 — 송장에 찍히는 값 */
  phone: SenderField;
  /** 보내는 분 주소 = 출고지 */
  origin: SenderField;
}

export function originTextOf(
  origin: WaybillSenderOrigin | null | undefined
): string | null {
  if (!origin?.baseAddress) {
    return null;
  }

  const address = [origin.baseAddress, origin.detailAddress]
    .filter((part) => part.trim())
    .join(' ');

  return origin.zip ? `(${origin.zip}) ${address}` : address;
}

function fieldOf(
  text: string | null | undefined,
  source: WaybillSenderFieldSource | undefined
): SenderField {
  if (!text || !source || source === 'unknown') {
    return { text: null, note: '' };
  }

  return { text, note: FIELD_SOURCE_TEXT[source] };
}

const UNKNOWN_FIELD: SenderField = { text: null, note: '' };

/** 서버 응답(없거나 실패면 undefined) → 화면 한 줄. 응답이 없으면 확인 불가로 둔다 */
export function senderLineOf(
  preview: WaybillSenderPreview | undefined
): SenderLine {
  if (!preview || preview.source === 'unknown' || !preview.name) {
    return {
      key: `unknown:${preview?.reason ?? 'none'}`,
      name: null,
      note: preview?.reason ? REASON_TEXT[preview.reason] : '',
      unknown: true,
      phone: UNKNOWN_FIELD,
      origin: UNKNOWN_FIELD,
    };
  }

  const phone = fieldOf(preview.phone, preview.phoneSource);
  const origin = fieldOf(originTextOf(preview.origin), preview.originSource);

  const note = preview.beforePlan
    ? `${SOURCE_TEXT[preview.source]} · 상자 확정 때 다시 정해져요`
    : SOURCE_TEXT[preview.source];

  return {
    key: JSON.stringify([
      preview.source,
      preview.name,
      preview.beforePlan,
      phone.text,
      phone.note,
      origin.text,
      origin.note,
    ]),
    name: preview.name,
    note,
    unknown: false,
    phone,
    origin,
  };
}

function changeText(label: string, field: SenderField): string {
  return field.text
    ? `${label} ${field.text}(${field.note})`
    : `${label} ${FIELD_UNKNOWN_TEXT}`;
}

/** 재발급하면 이름·전화·출고지가 바뀌는 송장 — 상자 상세가 재발급 전에 칸마다 출처와 함께 알린다 */
export function reissueSenderText(
  preview: WaybillSenderPreview | undefined
): string | null {
  if (!preview?.reissue) {
    return null;
  }

  const next = preview.reissue;
  const changes: string[] = [];

  if (next.name && next.name !== preview.name) {
    changes.push(`이름 ${next.name}(${SOURCE_TEXT[next.source]})`);
  }

  const nextPhone = fieldOf(next.phone, next.phoneSource);

  if (nextPhone.text !== fieldOf(preview.phone, preview.phoneSource).text) {
    changes.push(changeText('전화', nextPhone));
  }

  const nextOrigin = fieldOf(originTextOf(next.origin), next.originSource);

  if (
    nextOrigin.text !==
    fieldOf(originTextOf(preview.origin), preview.originSource).text
  ) {
    changes.push(changeText('출고지', nextOrigin));
  }

  if (changes.length === 0) {
    return null;
  }

  return `재발급하면 ${changes.join(', ')}로 바뀌어요`;
}

export interface SenderGroup extends SenderLine {
  count: number;
}

/**
 * 확인창 요약 — 같은 이름·출처끼리 상자 수를 센다. 응답에 빠진 상자도 확인 불가로 센다.
 * 확인 불가 묶음은 맨 뒤에 둔다
 */
export function senderGroupsOf(
  shipmentIds: readonly string[],
  previews: readonly WaybillSenderPreview[] | undefined
): SenderGroup[] {
  const groups = new Map<string, SenderGroup>();

  for (const shipmentId of shipmentIds) {
    const line = senderLineOf(
      previews?.find((preview) => preview.shipmentId === shipmentId)
    );
    const group = groups.get(line.key);

    if (group) {
      group.count += 1;
    } else {
      groups.set(line.key, { ...line, count: 1 });
    }
  }

  return [...groups.values()].sort(
    (a, b) => Number(a.unknown) - Number(b.unknown)
  );
}
