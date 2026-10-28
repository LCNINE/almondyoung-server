import { WAYBILL } from './waybill.constants';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// UUID(128bit) → 접두사 + Crockford base32(26자) = 28자(≤30B). 결정적·전단사(§3.1-1).
// 기본 'AY' 는 출고 상자, 회수 행은 'AR'(WAYBILL.RETURN_CUST_ORD_NO_PREFIX).
export function deriveCustOrdNo(shipmentId: string, prefix: string = WAYBILL.CUST_ORD_NO_PREFIX): string {
  const hex = shipmentId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`deriveCustOrdNo: invalid uuid ${shipmentId}`);
  }
  const bytes = Buffer.from(hex, 'hex'); // 16 bytes
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD[(value << (5 - bits)) & 31];
  }
  return prefix + out;
}
