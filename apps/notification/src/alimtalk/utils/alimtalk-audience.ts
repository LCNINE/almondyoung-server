import { toKrE164 } from '../../sms-gate/clients/sms-gate.client';

export interface AlimtalkMember {
  userId: string;
  username: string;
  phoneNumber: string;
}

export interface AlimtalkGroupRow {
  id: string;
  groupId: string;
  name: string;
  phone: string;
}

export interface ManualRecipient {
  phone: string;
  name?: string;
}

export interface AlimtalkRecipient {
  /** 회원은 userId, 그룹 행은 `group:<행 id>`, 직접 입력은 `manual:<번호>` */
  userId: string;
  phoneNumber: string;
  name: string;
  recipientGroupId?: string;
}

export interface AlimtalkAudience {
  recipients: AlimtalkRecipient[];
  /** 휴대폰 번호가 아니라서 뺀 수 */
  invalid: number;
  /** 앞선 대상과 번호가 겹쳐 한 통으로 합친 수 */
  duplicates: number;
}

// 알림톡과 대체 문자 모두 휴대폰으로만 간다 (010·011·016~019).
const KR_MOBILE_E164 = /^\+821[016789]\d{7,8}$/;

/** 회원 → 그룹 → 직접 입력 순으로 합친다. 같은 번호는 먼저 나온 한 명만 받는다. */
export function mergeAlimtalkAudience(input: {
  members: AlimtalkMember[];
  groupRows: AlimtalkGroupRow[];
  manual: ManualRecipient[];
}): AlimtalkAudience {
  const candidates: AlimtalkRecipient[] = [
    ...input.members.map((m) => ({ userId: m.userId, phoneNumber: m.phoneNumber, name: m.username })),
    ...input.groupRows.map((row) => ({
      userId: `group:${row.id}`,
      phoneNumber: row.phone,
      name: row.name,
      recipientGroupId: row.groupId,
    })),
    ...input.manual.map((m) => ({
      userId: `manual:${toKrE164(m.phone)}`,
      phoneNumber: m.phone,
      name: m.name?.trim() || toKrE164(m.phone).slice(-4),
    })),
  ];

  const seen = new Set<string>();
  const result: AlimtalkAudience = { recipients: [], invalid: 0, duplicates: 0 };
  for (const recipient of candidates) {
    const phone = toKrE164(recipient.phoneNumber);
    if (!KR_MOBILE_E164.test(phone)) {
      result.invalid += 1;
      continue;
    }
    if (seen.has(phone)) {
      result.duplicates += 1;
      continue;
    }
    seen.add(phone);
    result.recipients.push(recipient);
  }
  return result;
}
