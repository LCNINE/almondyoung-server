import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { CreateRefundDto } from '../shared/dtos/refunds/create-refund.dto';
import { IdempotencyService } from './Idempotency.service';
import { and, eq, sql } from 'drizzle-orm';
import { PaymentSessionsService } from './payment-sessions.service';
import { WalletTx } from '../shared/database';

// src/dto/create-refund.response.ts
export interface CreateRefundResponse {
  refundId: string;
  sessionId: string;
  refundedAmount: number; // 이번에 환불된 금액
  refundedSoFar: number; // 지금까지 누적 환불 금액 (이번 포함)
  refundableLeft: number; // 남은 환불 가능 금액
  status: 'COMPLETED' | 'FAILED';
  refundedAt: Date;
  metadata: Record<string, any>;
}

@Injectable()
export class RefundsService {
  constructor(
    private readonly dbService: DbService<typeof schema>,
    private readonly idempotency: IdempotencyService,
    private readonly paymentSessions: PaymentSessionsService,
  ) {}

  async createRefund(
    dto: CreateRefundDto,
    idemKey?: string,
  ): Promise<CreateRefundResponse> {
    return this.dbService.db.transaction<CreateRefundResponse>(async (tx) => {
      // 1) 멱등성 키 처리
      const idem = await this.idempotency.checkOrCreate<CreateRefundResponse>(
        tx,
        idemKey,
        dto,
        `/payments/${dto.capturedEventId}/refunds`,
      );
      if (idem.hit) return idem.response!;

      // 2) CAPTURED 이벤트 조회 (트랜잭션 일관성 위해 tx 사용)
      const [captured] = await tx
        .select()
        .from(schema.paymentEvents)
        .where(eq(schema.paymentEvents.id, dto.capturedEventId))
        .limit(1);

      if (!captured) {
        throw new BadRequestException('Captured event not found');
      }
      if (captured.status !== 'CAPTURED') {
        throw new ConflictException(
          `Refund allowed only for CAPTURED events (got ${captured.status})`,
        );
      }

      // 3) 세션 조회 (CAPTURED 이상 상태면 OK)
      const session = await this.paymentSessions.ensureStatus(
        captured.paymentSessionId,
        ['AUTHORIZED', 'CAPTURED', 'REFUNDED'],
      );

      // 4) 누적 환불 금액 조회
      const refundedSoFarBefore = await this.sumRefundsForCaptured(
        tx,
        captured.id,
      );
      const refundableLeftBefore = Number(session.amount) - refundedSoFarBefore;

      if (dto.amount > refundableLeftBefore) {
        throw new ConflictException(
          `Exceeds refundable amount: requested=${dto.amount}, left=${refundableLeftBefore}`,
        );
      }

      // 5) 환불 실행
      const [refund] = await tx
        .insert(schema.refundEvents)
        .values({
          paymentEventId: captured.id,
          refundAccountId: dto.refundAccountId ?? undefined,
          amount: dto.amount,
          status: 'COMPLETED', // MVP stub
          reason: dto.reason ?? undefined,
          completedBy: 'SYSTEM',
          completedAt: new Date(),
          metadata: dto.metadata ? JSON.stringify(dto.metadata) : undefined,
        })
        .returning();

      // 환불 후 금액 재계산
      const refundedSoFar = refundedSoFarBefore + dto.amount;
      const refundableLeft = Number(session.amount) - refundedSoFar;

      // 6) 세션 이벤트 적재
      await tx.insert(schema.paymentSessionEvents).values([
        {
          paymentSessionId: session.id,
          eventType: 'REFUND_REQUESTED',
          eventData: JSON.stringify(dto),
        },
        {
          paymentSessionId: session.id,
          eventType: 'REFUND_COMPLETED',
          eventData: JSON.stringify({ refundId: refund.id }),
        },
      ]);

      // 7) 응답 구성
      const response: CreateRefundResponse = {
        refundId: refund.id,
        sessionId: session.id,
        refundedAmount: dto.amount,
        refundedSoFar,
        refundableLeft,
        status: 'COMPLETED',
        refundedAt: refund.completedAt!,
        metadata: dto.metadata ?? {},
      };

      // 8) 멱등성 완료 저장
      await this.idempotency.complete(tx, idemKey, response, 200);
      return response;
    });
  }

  private async sumRefundsForCaptured(
    tx: WalletTx,
    capturedEventId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({
        total: sql<number>`coalesce(sum(${schema.refundEvents.amount}), 0)`,
      })
      .from(schema.refundEvents)
      .where(
        and(
          eq(schema.refundEvents.paymentEventId, capturedEventId),
          eq(schema.refundEvents.status, 'COMPLETED'),
        ),
      );

    return Number(row?.total ?? 0);
  }
}
