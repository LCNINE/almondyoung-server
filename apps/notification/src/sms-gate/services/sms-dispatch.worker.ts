import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SmsDispatchManager } from './sms-dispatch.manager';
import { SmsGateClient } from '../clients/sms-gate.client';

@Injectable()
export class SmsDispatchWorker {
  constructor(
    private readonly dispatchManager: SmsDispatchManager,
    private readonly client: SmsGateClient,
  ) {}

  // cron-overlap-safe: pg_try_advisory_xact_lock 으로 한 인스턴스만 발송 구간에 들어가고, 행은 PENDING→PROCESSING CAS 로 집는다 (ADR-0036).
  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    if (!this.client.isConfigured()) return;
    await this.dispatchManager.dispatchDue(new Date());
  }
}
