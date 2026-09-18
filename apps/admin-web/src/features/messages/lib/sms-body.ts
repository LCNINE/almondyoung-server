import type { SmsGateCategory } from '@/lib/api/domains/sms-gate';

export const MARKETING_PREFIX = '(광고)';
export const MARKETING_FOOTER = "수신거부: 이 번호로 '수신거부' 회신";

export function composeSmsBody(category: SmsGateCategory, content: string): string {
  const text = content.trim();
  if (category !== 'MARKETING') return text;
  const body = text.startsWith(MARKETING_PREFIX) ? text.slice(MARKETING_PREFIX.length).trimStart() : text;
  return `${MARKETING_PREFIX} ${body}\n${MARKETING_FOOTER}`;
}
