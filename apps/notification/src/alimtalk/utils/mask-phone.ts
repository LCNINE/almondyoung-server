import { toKrE164 } from '../../sms-gate/clients/sms-gate.client';

/** 010-****-1234 */
export function maskPhone(phone: string): string {
  const local = toKrE164(phone).replace(/^\+82/, '0');
  if (local.length < 8) return '****';
  return `${local.slice(0, 3)}-****-${local.slice(-4)}`;
}
