import { createHmac } from 'crypto';

export interface HanjinSignerCredentials {
  clientId: string;
  apiKey: string;
  secretKey: string;
}

// type 별칭(인터페이스 아님): 균일 string 속성이라 Record<string,string>→HeadersInit 에 할당 가능
// (인터페이스는 암묵 인덱스시그니처를 못 받아 fetch(headers) 오버로드가 불일치함)
export type HanjinSignedHeaders = {
  'Content-Type': string;
  'x-api-key': string;
  Authorization: string;
};

export class HanjinHmacSigner {
  constructor(
    private readonly creds: HanjinSignerCredentials,
    private readonly now: () => Date = () => new Date(),
  ) {}

  sign(method: string, url: string): HanjinSignedHeaders {
    const timestamp = this.kstTimestamp(this.now());
    const queryString = this.queryString(url);
    const message = timestamp + method.toUpperCase() + queryString + this.creds.secretKey;
    const signature = createHmac('sha256', this.creds.secretKey).update(message, 'utf8').digest('hex');
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.creds.apiKey,
      Authorization: `client_id=${this.creds.clientId} timestamp=${timestamp} signature=${signature}`,
    };
  }

  private queryString(url: string): string {
    const i = url.indexOf('?');
    return i >= 0 ? url.slice(i + 1) : '';
  }

  private kstTimestamp(d: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)!.value;
    return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
  }
}
