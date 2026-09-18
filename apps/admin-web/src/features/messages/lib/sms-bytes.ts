export const SMS_BYTE_LIMIT = 90;

export function smsByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) bytes += char.codePointAt(0)! > 127 ? 2 : 1;
  return bytes;
}

export function isLongSms(text: string): boolean {
  return smsByteLength(text) > SMS_BYTE_LIMIT;
}
