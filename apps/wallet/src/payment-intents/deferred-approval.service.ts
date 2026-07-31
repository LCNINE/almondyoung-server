import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { ChargesService } from '../charges/charges.service';
import { TossApproveService } from './toss-approve.service';
import { isDeferredApprovalIntent, readStagedApproval } from './deferred-approval';

/** 이미 승인(또는 그 이후 단계)이 끝난 상태 — finalize 는 멱등 no-op 이 된다. */
const ALREADY_APPROVED_STATUSES = ['AUTHORIZED', 'CAPTURED', 'PARTIALLY_CAPTURED', 'SUCCEEDED'];

/**
 * 적재된 PG 승인을 실제 승인으로 확정한다.
 *
 * 호출자는 Medusa 의 almond-payment provider — completeCartWorkflow 가 주문 생성과 재고예약을
 * 모두 성공시킨 마지막 단계(authorizePaymentSession)에서 호출한다. 즉 이 호출이 성공해야만
 * 고객 돈이 움직이고, 그 전에 워크플로가 실패하면 승인은 일어나지 않는다.
 */
@Injectable()
export class DeferredApprovalService {
  private readonly logger = new Logger(DeferredApprovalService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly tossApproveService: TossApproveService,
  ) {}

  async finalize(intentId: string, correlationId: string): Promise<{ status: string }> {
    const intent = await this.loadIntent(intentId);

    // 재시도/중복 호출 멱등: 이미 승인된 intent 는 그대로 성공 응답.
    if (ALREADY_APPROVED_STATUSES.includes(intent.status)) {
      return { status: intent.status };
    }

    if (!isDeferredApprovalIntent(intent.metadata)) {
      throw new ConflictException({
        error: 'NOT_DEFERRED_APPROVAL_INTENT',
        message: `Intent is not in deferred approval mode: ${intentId}`,
      });
    }

    const charge = await this.chargesService.findActiveByIntentAndOperation(intentId, 'AUTHORIZE');
    const staged = charge && charge.status === 'REQUIRES_ACTION' ? readStagedApproval(charge) : null;

    if (!charge || !staged) {
      // 고객이 결제창을 완료하지 않았거나, 적재 후 만료 회수(TossActionExpirationJob)된 경우.
      // 승인할 대상이 없으므로 호출자(Medusa)가 주문을 롤백하게 409 로 알린다.
      throw new ConflictException({
        error: 'NO_STAGED_APPROVAL',
        message: `No staged approval to finalize for intent: ${intentId} (status=${intent.status})`,
      });
    }

    this.logger.log(`finalizing staged approval: intentId=${intentId} provider=${staged.provider}`);
    await this.tossApproveService.confirmStaged(charge, staged, correlationId);

    const updated = await this.loadIntent(intentId);
    return { status: updated.status };
  }

  private async loadIntent(intentId: string): Promise<typeof paymentIntents.$inferSelect> {
    const [intent] = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);

    if (!intent) {
      throw new NotFoundException({
        error: 'INTENT_NOT_FOUND',
        message: `Payment intent not found: ${intentId}`,
      });
    }
    return intent;
  }
}
