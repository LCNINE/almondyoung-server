import type {
  CreateDeliveryProfileDto,
  DeliveryProfileDto,
  DeliveryProfileSourceType,
  FulfillmentMode,
  UpdateDeliveryProfileDto,
} from '@/lib/types/dto/inventory';

export type ProfileFormState = {
  name: string;
  sourceType: DeliveryProfileSourceType;
  avgDeliveryDays: string;
  senderName: string;
  senderPhone: string;
  originPostalCode: string;
  originRoadAddress: string;
  originDetailAddress: string;
  returnPostalCode: string;
  returnRoadAddress: string;
  returnDetailAddress: string;
  returnPhone: string;
  carrierAccountRef: string;
  modes: FulfillmentMode[];
};

export type ProfileFormErrors = Partial<Record<keyof ProfileFormState, string>>;

export function emptyProfileForm(): ProfileFormState {
  return {
    name: '',
    sourceType: 'in_house',
    avgDeliveryDays: '',
    senderName: '',
    senderPhone: '',
    originPostalCode: '',
    originRoadAddress: '',
    originDetailAddress: '',
    returnPostalCode: '',
    returnRoadAddress: '',
    returnDetailAddress: '',
    returnPhone: '',
    carrierAccountRef: '',
    modes: ['in_house'],
  };
}

export function formFromProfile(p: DeliveryProfileDto): ProfileFormState {
  return {
    name: p.name,
    sourceType: p.sourceType,
    avgDeliveryDays: p.avgDeliveryDays === null ? '' : String(p.avgDeliveryDays),
    senderName: p.sender.name,
    senderPhone: p.sender.phone,
    originPostalCode: p.originAddress.postalCode,
    originRoadAddress: p.originAddress.roadAddress,
    originDetailAddress: p.originAddress.detailAddress,
    returnPostalCode: p.returnAddress.postalCode,
    returnRoadAddress: p.returnAddress.roadAddress,
    returnDetailAddress: p.returnAddress.detailAddress,
    returnPhone: p.returnAddress.phone ?? '',
    carrierAccountRef: p.carrierAccountRef ?? '',
    modes: p.supportedFulfillmentModes,
  };
}

// core DTO 의 필수 규칙과 같다(공백만 있는 값 거부). 서버가 최종 판정자이고 이건 헛걸음 방지용이다.
const REQUIRED: Array<keyof ProfileFormState> = [
  'name',
  'senderName',
  'senderPhone',
  'originPostalCode',
  'originRoadAddress',
  'returnPostalCode',
  'returnRoadAddress',
  'carrierAccountRef',
];

export function validateProfileForm(s: ProfileFormState): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  for (const key of REQUIRED) {
    const value = s[key];
    if (typeof value === 'string' && !value.trim()) errors[key] = '필수 항목입니다.';
  }
  if (s.modes.length === 0) errors.modes = '이행 방식을 하나 이상 고르세요.';
  if (s.avgDeliveryDays.trim() && !/^\d+$/.test(s.avgDeliveryDays.trim())) {
    errors.avgDeliveryDays = '0 이상의 정수로 입력하세요.';
  }
  return errors;
}

function sender(s: ProfileFormState) {
  return { name: s.senderName.trim(), phone: s.senderPhone.trim() };
}
function origin(s: ProfileFormState) {
  return {
    postalCode: s.originPostalCode.trim(),
    roadAddress: s.originRoadAddress.trim(),
    detailAddress: s.originDetailAddress.trim(),
  };
}
function returnAddress(s: ProfileFormState) {
  return {
    postalCode: s.returnPostalCode.trim(),
    roadAddress: s.returnRoadAddress.trim(),
    detailAddress: s.returnDetailAddress.trim(),
    ...(s.returnPhone.trim() ? { phone: s.returnPhone.trim() } : {}),
  };
}

export function toCreatePayload(s: ProfileFormState): CreateDeliveryProfileDto {
  return {
    name: s.name.trim(),
    sourceType: s.sourceType,
    ...(s.avgDeliveryDays.trim() ? { avgDeliveryDays: Number(s.avgDeliveryDays.trim()) } : {}),
    sender: sender(s),
    originAddress: origin(s),
    returnAddress: returnAddress(s),
    carrierAccountRef: s.carrierAccountRef.trim(),
    supportedFulfillmentModes: s.modes,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 바뀐 필드만. 중첩 객체는 한 칸만 바뀌어도 통째로 보낸다(core PATCH 계약). */
export function toUpdatePayload(before: DeliveryProfileDto, s: ProfileFormState): UpdateDeliveryProfileDto {
  const next = toCreatePayload(s);
  const beforeForm = toCreatePayload(formFromProfile(before));
  const payload: UpdateDeliveryProfileDto = {};
  if (next.name !== beforeForm.name) payload.name = next.name;
  if (next.sourceType !== beforeForm.sourceType) payload.sourceType = next.sourceType;
  if (next.avgDeliveryDays !== beforeForm.avgDeliveryDays && next.avgDeliveryDays !== undefined) {
    payload.avgDeliveryDays = next.avgDeliveryDays;
  }
  if (!same(next.sender, beforeForm.sender)) payload.sender = next.sender;
  if (!same(next.originAddress, beforeForm.originAddress)) payload.originAddress = next.originAddress;
  if (!same(next.returnAddress, beforeForm.returnAddress)) payload.returnAddress = next.returnAddress;
  if (next.carrierAccountRef !== beforeForm.carrierAccountRef) payload.carrierAccountRef = next.carrierAccountRef;
  if (!same(next.supportedFulfillmentModes, beforeForm.supportedFulfillmentModes)) {
    payload.supportedFulfillmentModes = next.supportedFulfillmentModes;
  }
  return payload;
}
