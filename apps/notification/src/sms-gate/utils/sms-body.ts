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

export const FALLBACK_NAME = '원장';
const NOT_A_NAME = /^[\d\s\-+().]*$/;

export function fillName(content: string, name: string): string {
  const shown = NOT_A_NAME.test(name) ? FALLBACK_NAME : name.trim();
  return content.replaceAll(NAME_VARIABLE, () => shown);
}

export function longestFilledName(names: string[]): string | null {
  return names.reduce<string | null>((longest, name) => {
    const filled = fillName(NAME_VARIABLE, name);
    return longest === null || filled.length > longest.length ? filled : longest;
  }, null);
}

export function isMarketingQuietHours(now: Date): boolean {
  const hour = new Date(now.getTime() + KST_OFFSET_MS).getUTCHours();
  return hour >= 21 || hour < 8;
}
