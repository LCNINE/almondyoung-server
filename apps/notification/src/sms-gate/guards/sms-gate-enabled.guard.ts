import { CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SmsGateClient } from '../clients/sms-gate.client';

@Injectable()
export class SmsGateEnabledGuard implements CanActivate {
  constructor(private readonly client: SmsGateClient) {}

  canActivate(): boolean {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('폰 문자 발송은 아직 열리지 않은 기능입니다');
    }
    return true;
  }
}
