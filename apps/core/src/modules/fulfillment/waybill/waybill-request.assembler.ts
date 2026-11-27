import { BadRequestError } from '@app/shared';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import type { WaybillRequest } from './carrier/carrier-gateway.interface';
import { deriveCustOrdNo } from './cust-ord-no';
import { WAYBILL } from './waybill.constants';
import type {
  ManifestLineLite,
  ProfileSender,
  SenderPreview,
  SenderPreviewInput,
  WaybillRecipient,
} from './waybill.types';

// 상세주소는 없는 주소(단독주택 등)가 있어 받지 않는다. 한진은 빈 상세주소를 거절하므로 보낼 때 대체값을 넣는다(hanjin-carrier.gateway).
export const REQUIRED_RECIPIENT_FIELDS = ['recipientName', 'phone', 'postalCode', 'roadAddress'] as const;

export function parseRecipient(snapshot: unknown): WaybillRecipient {
  const r = (snapshot ?? {}) as Record<string, unknown>;
  const missing = REQUIRED_RECIPIENT_FIELDS.filter((k) => typeof r[k] !== 'string' || !r[k].trim());
  if (missing.length) {
    throw new BadRequestError(`${WAYBILL.ERROR.RECIPIENT_INCOMPLETE}: missing ${missing.join(',')}`);
  }
  const note = typeof r.deliveryNote === 'string' && r.deliveryNote.trim() ? r.deliveryNote : undefined;
  return {
    recipientName: r.recipientName as string,
    phone: r.phone as string,
    postalCode: r.postalCode as string,
    roadAddress: r.roadAddress as string,
    detailAddress: typeof r.detailAddress === 'string' ? r.detailAddress : '',
    deliveryNote: note,
  };
}

export interface AssembleInput {
  shipmentId: string;
  recipientSnapshot: unknown;
  lines: ManifestLineLite[];
  config: HanjinConfig;
  /** 송장에만 싣고 저장하지 않는다. shipments.entrance_password 에서 온다. */
  entrancePassword?: string | null;
  profileSender?: ProfileSender | null;
  /**
   * 이미 만든 송장 행의 sender_snapshot. 재시도는 이 값을 넘긴다(새 발급은 넘기지 않는다).
   * 이 칸이 생기기 전 송장(null)은 그때처럼 HANJIN_SENDER_* 로 등록됐으므로 그 값을 쓴다
   */
  storedSender?: unknown;
}

// jsonb 는 unknown 이라 키 접근에 캐스팅이 필요하다. 값 타입은 str 이 다시 본다
const fieldsOf = (v: unknown) => (v ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 배송 프로필의 보내는 분·출고지 스냅샷. 이름이 없으면 프로필 값을 쓰지 않는다(빈 보낸분이 찍히지 않게) */
export function profileSenderOf(sender: unknown, origin: unknown): ProfileSender | null {
  const s = fieldsOf(sender);
  const o = fieldsOf(origin);
  const name = str(s.name);
  if (!name) return null;

  return {
    name,
    phone: str(s.phone),
    zip: str(o.postalCode),
    baseAddress: str(o.roadAddress),
    detailAddress: str(o.detailAddress),
  };
}

/** 프로필 값이 있으면 그것을, 빈 칸은 HANJIN_SENDER_* 를 쓴다. 주소는 우편번호·도로명이 다 있을 때만 통째로 바꾼다 */
export function senderOf(config: HanjinConfig, profile: ProfileSender | null | undefined): HanjinConfig['sender'] {
  if (!profile) return config.sender;

  const hasAddress = !!profile.zip && !!profile.baseAddress;

  return {
    name: profile.name,
    tel: profile.phone || config.sender.tel,
    zip: hasAddress ? profile.zip : config.sender.zip,
    baseAddress: hasAddress ? profile.baseAddress : config.sender.baseAddress,
    detailAddress: hasAddress ? profile.detailAddress : config.sender.detailAddress,
  };
}

/** 송장 행에 저장한 보내는 분. 칸이 하나라도 빠졌으면(이 칸이 생기기 전 송장) null */
export function storedSenderOf(snapshot: unknown): HanjinConfig['sender'] | null {
  const s = fieldsOf(snapshot);
  const sender = {
    name: str(s.name),
    zip: str(s.zip),
    baseAddress: str(s.baseAddress),
    detailAddress: str(s.detailAddress),
    tel: str(s.tel),
  };

  return sender.name && sender.zip && sender.baseAddress ? sender : null;
}

/** 보내는 분이 어디서 왔나 — waybill: 이미 만든 송장 행, profile: 상자의 배송 프로필, default: HANJIN_SENDER_* */
export type SenderSource = 'waybill' | 'profile' | 'default';

/** 송장에 실을 보내는 분. 발급(assembleWaybillRequest)과 발급 전 미리보기가 이 함수 하나로 고른다 */
export function resolveSender(input: Pick<AssembleInput, 'config' | 'profileSender' | 'storedSender'>): {
  sender: HanjinConfig['sender'];
  source: SenderSource;
} {
  if (input.storedSender !== undefined) {
    const stored = storedSenderOf(input.storedSender);
    return stored ? { sender: stored, source: 'waybill' } : { sender: input.config.sender, source: 'default' };
  }
  return input.profileSender
    ? { sender: senderOf(input.config, input.profileSender), source: 'profile' }
    : { sender: input.config.sender, source: 'default' };
}

/**
 * 발급 전 미리보기 — 발급과 같은 resolveSender 로 고른다. 택배사 설정이 비었거나 확정이 막히는 상자처럼
 * 실제 값을 장담할 수 없으면 이름을 내지 않고 unknown 으로 둔다(화면은 «확인 불가»로 보인다)
 */
export function senderPreviewOf(
  input: SenderPreviewInput,
  config: HanjinConfig,
  carrierConfigured: boolean,
): SenderPreview {
  const base = { shipmentId: input.shipmentId, beforePlan: input.beforePlan };
  const unknown = (reason: NonNullable<SenderPreview['reason']>): SenderPreview => ({
    ...base,
    name: null,
    source: 'unknown',
    reason,
  });

  if (!input.found) return unknown('not_found');
  if (input.manualWaybill) return unknown('manual_waybill');
  if (input.storedSender === undefined) {
    if (!carrierConfigured) return unknown('carrier_not_configured');
    if (input.profileIncompatible) return unknown('profile_incompatible');
  } else if (!carrierConfigured && (input.activeStatus === 'pending' || input.activeStatus === 'allocated')) {
    // 멈춘 송장은 이어 가야 한진에 실리는데, 설정이 비면 이어 가기가 거절된다(resumeActive)
    return unknown('carrier_not_configured');
  }

  const { sender, source } = resolveSender({
    config,
    profileSender: input.profileSender,
    storedSender: input.storedSender,
  });
  const name = sender.name.trim();
  if (!name) return unknown('sender_missing');

  // 재발급은 지금 송장을 무효로 하고 상자의 배송 프로필로 새로 조립한다(reissue → issueForShipment)
  if (input.activeStatus === 'registered' && carrierConfigured) {
    const next = resolveSender({ config, profileSender: input.profileSender });
    const nextName = next.sender.name.trim();
    if (nextName && nextName !== name && next.source !== 'waybill') {
      return { ...base, name, source, reissue: { name: nextName, source: next.source } };
    }
  }
  return { ...base, name, source };
}

/**
 * 배송 메시지 = 메모 라벨 + 공동현관 비번. 합성 결과는 어디에도 저장하지 않는다.
 * 운송장 라벨(#913)도 이 함수를 쓴다 — 한진에 보낸 문자열과 라벨 문자열이 같은 함수에서 나와야 한다.
 */
export function composeMessage(deliveryNote: string | undefined, entrancePassword: string | null | undefined) {
  const parts = [deliveryNote, entrancePassword ? `공동현관 ${entrancePassword}` : undefined].filter(
    (part): part is string => !!part,
  );
  if (parts.length === 0) return undefined;
  return parts.length === 2 ? `${parts[0]} (${parts[1]})` : parts[0];
}

/** 품명 = 첫 상품명 + 「외 N건」. 한진 등록값과 라벨 품명이 같은 함수에서 나온다(#913). */
export function commodityNameOf<L extends { productName: string }>(lines: readonly L[]): string {
  const head = lines[0]?.productName ?? '';
  return lines.length > 1 ? `${head} 외 ${lines.length - 1}건` : head;
}

export function assembleWaybillRequest(input: AssembleInput): WaybillRequest {
  const rc = parseRecipient(input.recipientSnapshot);
  const items = input.lines.map((l) => ({ name: l.productName, quantity: l.quantity }));
  const commodityName = commodityNameOf(input.lines);
  return {
    custOrdNo: deriveCustOrdNo(input.shipmentId),
    recipient: {
      name: rc.recipientName,
      zip: rc.postalCode,
      baseAddress: rc.roadAddress,
      detailAddress: rc.detailAddress,
      // 스냅샷의 연락처는 단일 phone 필드(=휴대폰)뿐이라 carrier 중립 요청에는 mobile 로만 싣는다.
      // 한진은 rcvrTelNo(전화번호)가 필수·rcvrMobileNo 가 선택이므로(정본 §4.2 19·20번)
      // 그 폴백은 한진 게이트웨이가 한다 — 여기서 tel 이 비는 것은 누락이 아니라 위임이다.
      mobile: rc.phone,
      message: composeMessage(rc.deliveryNote, input.entrancePassword),
    },
    sender: resolveSender(input).sender,
    items,
    commodityName,
    boxType: input.config.boxType,
    payType: input.config.payType,
  };
}
