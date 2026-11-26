import { toKrE164 } from '../../../apps/notification/src/sms-gate/clients/sms-gate.client';

/** 테넌트 안의 번호 있는 계정 하나. active = 탈퇴·휴면 아님(UsersService.smsAudienceConditions 의 활성 조건). */
export interface AudienceMember {
  userId: string;
  username: string;
  phoneNumber: string;
  marketingConsent: boolean;
  active: boolean;
}

export interface ExportRecipient {
  /** E.164 */
  phone: string;
  /** 번호로 회원 한 명을 찾았을 때만 */
  userId: string | null;
  username: string | null;
}

export interface RecipientCounts {
  listed: number;
  invalid: number;
  duplicateInList: number;
  optedOut: number;
  consentWithdrawn: number;
  matchedOne: number;
  matchedMany: number;
  nonMember: number;
  /** 번호의 계정이 휴면·탈퇴뿐 — 비회원으로 보내지 않는다 */
  inactiveMember: number;
  send: number;
}

const KR_MOBILE = /^\+8210\d{7,8}$/;

/** 엑셀·CSV 에서 읽은 번호를 E.164 로. 숫자 셀이 되어 앞의 0 이 빠진 번호(1012345678)도 받는다. */
export function normalizeListPhone(raw: string): string | null {
  const compact = raw.replace(/\s/g, '');
  if (!compact) return null;
  const restored = /^1\d{8,9}$/.test(compact) ? `0${compact}` : compact;
  const phone = toKrE164(restored);
  return KR_MOBILE.test(phone) ? phone : null;
}

/** 테넌트에서 번호 있는 계정을 하나도 못 읽었으면 멈춘다 — 틀린 --tenant 면 모두가 비회원이 되어 동의 거르기가 조용히 꺼진다. */
export function assertAudienceLoaded(members: AudienceMember[], tenantId: string): void {
  if (members.length === 0) {
    throw new Error(`테넌트 ${tenantId} 에서 번호 있는 계정을 하나도 찾지 못했다 — --tenant 값을 확인한다`);
  }
}

/**
 * 명단의 번호를 보낼 사람과 뺄 사람으로 가른다. 순서: 형식 → 명단 안 중복 → 수신거부 → 회원 동의.
 * 명단이 이미 수신거부를 뺀 것이어도 회원 동의를 다시 본다 — 명단을 뽑은 뒤 사이트에서 동의를 끈 회원에게 광고가 새지 않게.
 */
export function classifyRecipients(input: {
  listPhones: string[];
  members: AudienceMember[];
  optedOut: Set<string>;
}): { recipients: ExportRecipient[]; counts: RecipientCounts } {
  const membersByPhone = new Map<string, AudienceMember[]>();
  for (const member of input.members) {
    const phone = toKrE164(member.phoneNumber);
    membersByPhone.set(phone, [...(membersByPhone.get(phone) ?? []), member]);
  }

  const counts: RecipientCounts = {
    listed: input.listPhones.length,
    invalid: 0,
    duplicateInList: 0,
    optedOut: 0,
    consentWithdrawn: 0,
    matchedOne: 0,
    matchedMany: 0,
    nonMember: 0,
    inactiveMember: 0,
    send: 0,
  };
  const recipients: ExportRecipient[] = [];
  const seen = new Set<string>();

  for (const raw of input.listPhones) {
    const phone = normalizeListPhone(raw);
    if (!phone) {
      counts.invalid += 1;
      continue;
    }
    if (seen.has(phone)) {
      counts.duplicateInList += 1;
      continue;
    }
    seen.add(phone);
    if (input.optedOut.has(phone)) {
      counts.optedOut += 1;
      continue;
    }

    const accounts = membersByPhone.get(phone) ?? [];
    if (accounts.length === 0) {
      counts.nonMember += 1;
      recipients.push({ phone, userId: null, username: null });
      continue;
    }
    // 휴면·탈퇴 계정의 번호를 비회원으로 보내면, 동의를 끈 뒤 휴면된 회원에게 광고가 간다.
    const matched = accounts.filter((member) => member.active);
    if (matched.length === 0) {
      counts.inactiveMember += 1;
      continue;
    }
    if (!matched.some((member) => member.marketingConsent)) {
      counts.consentWithdrawn += 1;
      continue;
    }
    if (matched.length === 1) {
      counts.matchedOne += 1;
      recipients.push({ phone, userId: matched[0].userId, username: matched[0].username });
    } else {
      // 누구인지는 링크를 누르고 로그인할 때 연결 기록이 알려 준다.
      counts.matchedMany += 1;
      recipients.push({ phone, userId: null, username: null });
    }
  }

  counts.send = recipients.length;
  return { recipients, counts };
}
