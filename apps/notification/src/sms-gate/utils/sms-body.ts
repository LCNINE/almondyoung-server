export type SmsGateCategory = 'INFORMATIONAL' | 'MARKETING';

export const MARKETING_PREFIX = '(광고)';
export const MARKETING_FOOTER = "수신거부: 이 번호로 '수신거부' 회신";

export const NAME_VARIABLE = '{{이름}}';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function composeSmsBody(category: SmsGateCategory, content: string): string {
  const text = content.trim();
  if (category !== 'MARKETING') return text;
  const body = text.startsWith(MARKETING_PREFIX) ? text.slice(MARKETING_PREFIX.length).trimStart() : text;
  return `${MARKETING_PREFIX} ${body}\n${MARKETING_FOOTER}`;
}

export function fillName(content: string, name: string): string {
  return content.replaceAll(NAME_VARIABLE, () => name);
}

export function isMarketingQuietHours(now: Date): boolean {
  const hour = new Date(now.getTime() + KST_OFFSET_MS).getUTCHours();
  return hour >= 21 || hour < 8;
}
