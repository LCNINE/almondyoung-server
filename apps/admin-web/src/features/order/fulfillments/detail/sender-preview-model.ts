import type { WaybillSenderPreview } from '@/lib/types/dto/fulfillment';

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

export interface SenderLine {
  key: string;
  /** 찍힐 이름. 모르면 null */
  name: string | null;
  /** 이름 옆 작은 글씨: 출처나 확인 불가 사유 */
  note: string;
  unknown: boolean;
}

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
    };
  }

  const note = preview.beforePlan
    ? `${SOURCE_TEXT[preview.source]} · 상자 확정 때 다시 정해져요`
    : SOURCE_TEXT[preview.source];

  return {
    key: `${preview.source}:${preview.name}:${preview.beforePlan}`,
    name: preview.name,
    note,
    unknown: false,
  };
}

/** 재발급하면 이름이 바뀌는 송장 — 상자 상세가 재발급 전에 알린다 */
export function reissueSenderText(
  preview: WaybillSenderPreview | undefined
): string | null {
  if (!preview?.reissue) {
    return null;
  }

  return `재발급하면 ${preview.reissue.name}(${SOURCE_TEXT[preview.reissue.source]})로 바뀌어요`;
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
