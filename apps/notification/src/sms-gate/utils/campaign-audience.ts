import { toKrE164 } from '../clients/sms-gate.client';

export interface AudienceMember {
  userId: string;
  username: string;
  phoneNumber: string;
  marketingConsent: boolean;
}

export interface AudienceGroupRow {
  id: string;
  groupId: string;
  name: string;
  phone: string;
}

export interface CampaignRecipient {
  userId: string;
  phoneNumber: string;
  username: string;
  recipientGroupId?: string;
}

export interface MergedAudience {
  recipients: CampaignRecipient[];
  /** 번호 오류·광고 미동의·수신거부로 뺀 수 */
  excluded: number;
  /** 앞선 대상과 번호가 겹쳐 한 통으로 합친 수 */
  duplicates: number;
}

/**
 * 회원 → 그룹 순으로 합친다. 같은 번호(E.164)는 먼저 나온 한 명만 받는다.
 * 광고면 회원은 본인 동의로, 그룹 번호는 수신거부 목록과 "동의 안 한 회원의 번호" 둘 다로 거른다.
 * 사이트에서 동의를 끈 회원이 그룹(엑셀·카페24 등)에 들어 있어도 광고가 새지 않게 하려는 것이다.
 */
export function mergeCampaignAudience(input: {
  members: AudienceMember[];
  includeMembers: boolean;
  groupRows: AudienceGroupRow[];
  marketing: boolean;
  optedOut: Set<string>;
}): MergedAudience {
  const nonConsented = new Set(
    input.marketing ? input.members.filter((m) => !m.marketingConsent).map((m) => toKrE164(m.phoneNumber)) : [],
  );
  const candidates: (CampaignRecipient & { allowed: boolean })[] = [
    ...(input.includeMembers ? input.members : []).map((m) => ({
      userId: m.userId,
      phoneNumber: m.phoneNumber,
      username: m.username,
      allowed: !input.marketing || m.marketingConsent,
    })),
    ...input.groupRows.map((row) => {
      const phone = toKrE164(row.phone);
      return {
        userId: `group:${row.id}`,
        phoneNumber: row.phone,
        username: row.name,
        recipientGroupId: row.groupId,
        allowed: !input.marketing || (!input.optedOut.has(phone) && !nonConsented.has(phone)),
      };
    }),
  ];

  const seen = new Set<string>();
  const result: MergedAudience = { recipients: [], excluded: 0, duplicates: 0 };
  for (const { allowed, ...recipient } of candidates) {
    const phone = toKrE164(recipient.phoneNumber);
    if (phone === '+82' || !allowed) {
      result.excluded += 1;
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
