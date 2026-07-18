import { WAYBILL } from './waybill.constants';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// shipment UUID(128bit) → 'AY' + Crockford base32(26자) = 28자(≤30B). 결정적·전단사(§3.1-1).
export function deriveCustOrdNo(shipmentId: string): string {
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
  return WAYBILL.CUST_ORD_NO_PREFIX + out;
}
