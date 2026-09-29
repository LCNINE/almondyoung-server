import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NhnAlimtalkClient } from '../clients/nhn-alimtalk.client';
import { AlimtalkDispatchManager } from './alimtalk-dispatch.manager';

@Injectable()
export class AlimtalkDispatchWorker {
  constructor(
    private readonly dispatchManager: AlimtalkDispatchManager,
    private readonly client: NhnAlimtalkClient,
  ) {}

  // cron-overlap-safe: 행은 PENDING→PROCESSING CAS 로 집어서 두 인스턴스가 같은 행을 보내지 않는다 (ADR-0036).
  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    if (!this.client.isConfigured()) return;
    await this.dispatchManager.dispatchDue(new Date());
  }
}
