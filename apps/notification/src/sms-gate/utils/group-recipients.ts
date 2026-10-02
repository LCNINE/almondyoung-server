import { toKrE164 } from '../clients/sms-gate.client';

export interface RawRecipient {
  name?: string | null;
  phone?: string | null;
}

export interface GroupRecipientRow {
  name: string;
  phone: string;
}

// 010·011·016~019 휴대폰만. 크롤링 번호 대부분인 0507 안심번호와 유선은 문자를 못 받아 폰 하루 한도만 깎는다.
const KR_MOBILE_E164 = /^\+821[016789]\d{7,8}$/;
const NAME_MAX = 100;

/** 휴대폰이 아니거나 앞서 나온 번호는 버린다. 이름이 비면 번호 뒤 4자리로 대신한다. */
export function toGroupRecipientRows(raws: RawRecipient[]): { rows: GroupRecipientRow[]; skipped: number } {
  const seen = new Set<string>();
  const rows: GroupRecipientRow[] = [];
  for (const raw of raws) {
    const phone = raw.phone ? toKrE164(raw.phone) : '';
    if (!KR_MOBILE_E164.test(phone) || seen.has(phone)) continue;
    seen.add(phone);
    rows.push({ name: (raw.name?.trim() || phone.slice(-4)).slice(0, NAME_MAX), phone });
  }
  return { rows, skipped: raws.length - rows.length };
}
