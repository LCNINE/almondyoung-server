import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DbService } from '@app/db';
import { PaginatedResponseDto } from '@app/shared';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { WalletSchema, charges, paymentIntents, paymentMethods } from '../schema';
import { ChargesService } from '../charges/charges.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import { PendingBankTransferResponseDto } from './dto/pending-bank-transfer.dto';

@Injectable()
export class BankTransferAdminService {
  private readonly logger = new Logger(BankTransferAdminService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async getPendingTransfers(page = 1, limit = 20): Promise<PaginatedResponseDto<PendingBankTransferResponseDto>> {
    const db = this.dbService.db;
    const offset = (page - 1) * limit;

    const condition = and(
      inArray(paymentIntents.status, ['AWAITING_DEPOSIT', 'REQUIRES_ACTION']),
      eq(paymentMethods.type, 'BANK_TRANSFER'),
    );

    const [countResult] = await db
      .select({ value: count() })
      .from(paymentIntents)
      .innerJoin(paymentMethods, eq(paymentIntents.paymentMethodId, paymentMethods.id))
      .where(condition);

    const total = countResult?.value ?? 0;

    // 은행/계좌/예금주는 authorize 시점에 charges.responsePayload.nextAction 으로 스냅샷된다.
    // 활성 AUTHORIZE charge 는 active unique index 로 intent 당 최대 1건이라 left join 으로 안전하게 가져온다.
    const rows = await db
      .select({
        id: paymentIntents.id,
        payableAmount: paymentIntents.payableAmount,
        currency: paymentIntents.currency,
        status: paymentIntents.status,
        userId: paymentIntents.userId,
        paymentMethodId: paymentIntents.paymentMethodId,
        expiresAt: paymentIntents.expiresAt,
        createdAt: paymentIntents.createdAt,
        bankName: sql<string | null>`${charges.responsePayload}->'nextAction'->>'bankName'`,
        accountNumber: sql<string | null>`${charges.responsePayload}->'nextAction'->>'accountNumber'`,
        accountHolder: sql<string | null>`${charges.responsePayload}->'nextAction'->>'accountHolder'`,
      })
      .from(paymentIntents)
      .innerJoin(paymentMethods, eq(paymentIntents.paymentMethodId, paymentMethods.id))
      .leftJoin(
        charges,
        and(
          eq(charges.intentId, paymentIntents.id),
          eq(charges.operation, 'AUTHORIZE'),
          eq(charges.status, 'REQUIRES_ACTION'),
        ),
      )
      .where(condition)
      .orderBy(desc(paymentIntents.createdAt))
      .limit(limit)
      .offset(offset);

    const data: PendingBankTransferResponseDto[] = rows.map((r) => ({
      id: r.id,
      payableAmount: r.payableAmount,
      currency: r.currency,
      status: r.status,
      userId: r.userId,
      paymentMethodId: r.paymentMethodId,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      // env(BANK_TRANSFER_*) 미설정이면 빈 문자열로 저장되므로 null 로 정규화한다.
      bankName: r.bankName || null,
      accountNumber: r.accountNumber || null,
      accountHolder: r.accountHolder || null,
    }));

    return { data, total, page, limit };
  }

  async confirmDeposit(intentId: string, depositorNote?: string): Promise<void> {
    this.logger.log(`confirmDeposit called: intentId=${intentId} depositorNote=${depositorNote}`);

    // 1. Find the REQUIRES_ACTION AUTHORIZE charge
    const charge = await this.chargesService.findActiveByIntentAndOperation(intentId, 'AUTHORIZE');
    this.logger.log(`charge found: ${JSON.stringify({ id: charge?.id, status: charge?.status })}`);
    if (!charge || charge.status !== 'REQUIRES_ACTION') {
      throw new UnprocessableEntityException({
        error: 'NO_REQUIRES_ACTION_CHARGE',
        message: 'No pending bank transfer action found for this intent',
      });
    }

    // 2. Load intent for outbox event payload
    const intent = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1)
      .then((r) => r[0]);

    if (!intent) {
      throw new NotFoundException({ error: 'INTENT_NOT_FOUND' });
    }

    const correlationId = `bank-transfer-confirm:${intentId}:${Date.now()}`;
    const now = new Date().toISOString();

    // 3. Transaction: charge → SUCCEEDED, intent → AUTHORIZED → CAPTURED + outbox event
    //
    // 무통장입금은 PG 가 없어 authorize 시점에 REQUIRES_ACTION 으로 멈춰 있다.
    // 입금 확인 = 자금 확인(AUTHORIZED) + 정산(CAPTURED) 이 한 번에 일어나는 것이므로
    // 상태머신이 허용하는 정식 경로(REQUIRES_ACTION → AUTHORIZED → CAPTURED)로 두 단계 전이한다.
    // (REQUIRES_ACTION → CAPTURED / SUCCEEDED 직접 전이는 상태머신에 없음 — SUCCEEDED 는 legacy 상태.)
    // 최종 상태를 CAPTURED 로 둬야 Medusa 가 payment.intent.captured → SUCCESSFUL 로 받아 주문을 완료 처리한다.
    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(
        charge.id,
        'SUCCEEDED',
        {
          providerTransactionId: depositorNote ?? 'BANK_TRANSFER_CONFIRMED',
        },
        tx,
      );

      // 중간 전이: 자금 확인. 입금 확인은 단일 milestone 이므로 별도 비즈니스 이벤트는 발행하지 않는다.
      await this.stateTransitionService.transitionIntent(
        intentId,
        'AUTHORIZED',
        {
          correlationId,
          triggeredByType: 'ADMIN',
          reasonCode: 'BANK_TRANSFER_CONFIRMED',
        },
        undefined,
        tx,
      );

      await this.stateTransitionService.transitionIntent(
        intentId,
        'CAPTURED',
        {
          correlationId,
          triggeredByType: 'ADMIN',
          reasonCode: 'BANK_TRANSFER_CONFIRMED',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_CAPTURED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              userId: intent.userId ?? '',
              status: 'CAPTURED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              occurredAt: now,
            }),
          },
        },
        undefined,
        tx,
      );
    });

    this.logger.log(`confirmDeposit succeeded: intentId=${intentId}`);
  }
}
