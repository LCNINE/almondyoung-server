import { fillName } from '../../../apps/notification/src/sms-gate/utils/sms-body';
import { newLinkCode, trackLinks } from '../../../apps/notification/src/sms-gate/utils/tracked-links';
import { ExportRecipient } from './recipients';

/** 발송 서비스가 광고 문자에 스스로 붙이는 `(광고)`·무료수신거부 문구의 바이트. 본문에는 넣지 않는다. */
export const SENDER_FIXED_BYTES = 33;
export const SMS_MAX_BYTES = 90;
export const LMS_MAX_BYTES = 2000;

/** 발송 서비스(EUC-KR) 기준 바이트: ASCII 1, 그 밖 2, 고정 문구 포함. */
export function uploadMessageBytes(body: string): number {
  let bytes = SENDER_FIXED_BYTES;
  for (const char of body) bytes += char.charCodeAt(0) < 0x80 ? 1 : 2;
  return bytes;
}

export interface ExportRow {
  recipient: ExportRecipient;
  body: string;
  bytes: number;
  links: { code: string; url: string }[];
}

/** 이름(`{{이름}}`)을 채우고 본문의 URL 을 수신자마다 다른 `/r/<코드>` 로 바꾼다 — 우리 발송폰 대량 발송과 같은 규칙. */
export function buildRows(
  template: string,
  recipients: ExportRecipient[],
  storefrontUrl: string,
  newCode: () => string = newLinkCode,
): ExportRow[] {
  return recipients.map((recipient) => {
    const filled = fillName(template, recipient.username ?? '');
    const { body, links } = trackLinks(filled, `${storefrontUrl}/r`, newCode);
    if (links.length === 0) throw new Error('템플릿에 링크가 없습니다');
    return { recipient, body, bytes: uploadMessageBytes(body), links };
  });
}
