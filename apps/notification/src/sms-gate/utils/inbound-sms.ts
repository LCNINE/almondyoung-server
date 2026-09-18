import { createHmac, timingSafeEqual } from 'node:crypto';

const OPT_OUT_PATTERN =
  /거부|수신\s*동의\s*철회|그만\s*(보내|받)|보내지\s*(마|말)|차단|스팸|신고|광고\s*싫|안\s*받(을|겠|습)|\bstop\b|\bunsubscribe\b/i;

export interface SmsReceivedWebhook {
  event?: string;
  deviceId?: string;
  payload?: {
    messageId?: string;
    message?: string;
    sender?: string;
    receivedAt?: string;
  };
}

export function isOptOutMessage(message: string): boolean {
  return OPT_OUT_PATTERN.test(message);
}

export function isValidSignature(signingKey: string, rawBody: Buffer, timestamp?: string, signature?: string): boolean {
  if (!timestamp || !signature) return false;
  const expected = Buffer.from(
    createHmac('sha256', signingKey)
      .update(Buffer.concat([rawBody, Buffer.from(timestamp)]))
      .digest('hex'),
  );
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
