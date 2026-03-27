import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NicepayAuthService {
  private readonly logger = new Logger(NicepayAuthService.name);
  private cachedToken: string | null = null;
  private tokenExpiry = 0;

  async getAuthHeader(): Promise<string> {
    if (this.cachedToken && this.tokenExpiry > Date.now()) {
      return `Bearer ${this.cachedToken}`;
    }

    const clientId = process.env.NICEPAY_CLIENT_KEY ?? '';
    const secretKey = process.env.NICEPAY_SECRET_KEY ?? '';
    const basicAuth = Buffer.from(`${clientId}:${secretKey}`).toString('base64');

    const res = await fetch('https://api.nicepay.co.kr/v1/access-token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`NicePay access-token request failed: ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    this.cachedToken = data.accessToken as string;
    this.tokenExpiry = Date.now() + 25 * 60 * 1000; // 25분 캐시 (서버 만료 30분)
    this.logger.debug('NicePay access token refreshed');
    return `Bearer ${this.cachedToken}`;
  }
}
