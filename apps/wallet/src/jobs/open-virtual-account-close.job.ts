import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { DbService } from '@app/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { WalletSchema, charges } from '../schema';
import { TossApiClient } from '../providers/toss/toss-api.client';
import { VIRTUAL_ACCOUNT_LEFT_OPEN, usesTossWidget } from '../providers/toss/toss-widget-mode';

const BATCH_SIZE = 50;

/**
 * 닫지 못한 위젯 가상계좌를 charge·intent 상태와 무관하게 다시 닫는다.
 *
 * 승인 중 취소·만료가 먼저 끝나면 계좌는 이미 CANCELED/FAILED 인 charge 에 붙어, abandon·만료·취소 어느
 * 정리 경로도 다시 보지 않는다. 닫히기 전 입금은 웹훅이 DEPOSIT_ON_CANCELED_CHARGE 로 남긴다.
 * 진행 중 charge(REQUIRES_ACTION)는 abandon 이 무통장 provider 로 닫으므로 여기서 건드리지 않는다.
 */
@Injectable()
export class OpenVirtualAccountCloseJob {
  private readonly logger = new Logger(OpenVirtualAccountCloseJob.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly tossApi: TossApiClient,
  ) {}

  @CronOnce('*/10 * * * *', { name: 'open-virtual-account-close' })
  async run(): Promise<void> {
    try {
      const result = await this.closeLeftOpen();
      if (result.scanned > 0)
        this.logger.log(`open virtual accounts: closed=${result.closed}, scanned=${result.scanned}`);
    } catch (error) {
      this.logger.error(`open virtual account close batch failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  async closeLeftOpen(): Promise<{ scanned: number; closed: number }> {
    const rows = await this.dbService.db
      .select({
        id: charges.id,
        providerTransactionId: charges.providerTransactionId,
        providerIdempotencyKey: charges.providerIdempotencyKey,
        responsePayload: charges.responsePayload,
      })
      .from(charges)
      .where(
        and(
          inArray(charges.status, ['CANCELED', 'FAILED']),
          sql`${charges.responsePayload} ? ${VIRTUAL_ACCOUNT_LEFT_OPEN}`,
        ),
      )
      // 실패한 행은 updated_at 을 밀어 뒤로 보낸다 — 계속 실패하는 계좌가 한 배치를 붙잡아 뒤 계좌가 굶지 않게.
      .orderBy(asc(charges.updatedAt))
      .limit(BATCH_SIZE);

    let closed = 0;
    for (const row of rows) {
      if (!row.providerTransactionId) continue;
      const result = await this.tossApi
        .cancelPayment(
          row.providerTransactionId,
          '결제 취소',
          undefined,
          `cancel:${row.providerIdempotencyKey}`,
          undefined,
          usesTossWidget(row.responsePayload),
        )
        .catch((error: unknown) => ({ ok: false as const, error: { code: undefined, message: String(error) } }));
      if (!result.ok && result.error.code !== 'ALREADY_CANCELED_PAYMENT') {
        this.logger.warn(`virtual account still open: chargeId=${row.id} error=${JSON.stringify(result.error)}`);
        await this.dbService.db.update(charges).set({ updatedAt: new Date() }).where(eq(charges.id, row.id));
        continue;
      }
      const payload = { ...(row.responsePayload ?? {}) };
      delete payload[VIRTUAL_ACCOUNT_LEFT_OPEN];
      await this.dbService.db
        .update(charges)
        .set({ responsePayload: payload, updatedAt: new Date() })
        .where(eq(charges.id, row.id));
      closed++;
    }
    return { scanned: rows.length, closed };
  }
}
