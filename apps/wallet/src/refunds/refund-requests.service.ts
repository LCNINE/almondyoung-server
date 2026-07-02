import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { PaginatedResponseDto } from '@app/shared';
import { and, desc, eq, count, inArray } from 'drizzle-orm';
import { WalletSchema, paymentIntents, paymentMethods, refundRequests } from '../schema';
import { RefundRequest } from '../types';
import { ChargesService } from '../charges/charges.service';
import { RefundsService } from './refunds.service';

type CreateRefundRequestInput = {
  bankCode: string;
  bankName?: string;
  accountNumber: string;
  holderName: string;
  reason?: string;
};

/** 결제완료로 간주하는 intent 상태 (환불 신청 가능). */
const REFUNDABLE_INTENT_STATUSES = ['CAPTURED', 'SUCCEEDED'] as const;

@Injectable()
export class RefundRequestsService {
  private readonly logger = new Logger(RefundRequestsService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly refundsService: RefundsService,
  ) {}

  /** 고객이 무통장(가상계좌) 주문에 대해 환불 요청을 제출한다. 실제 환불은 관리자 승인 시 실행. */
  async create(intentId: string, input: CreateRefundRequestInput, userId: string): Promise<RefundRequest> {
    const intent = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1)
      .then((r) => r[0]);
    if (!intent) throw new NotFoundException({ error: 'INTENT_NOT_FOUND' });
    if (intent.userId !== userId) throw new NotFoundException({ error: 'INTENT_NOT_FOUND' });
    if (!REFUNDABLE_INTENT_STATUSES.includes(intent.status as (typeof REFUNDABLE_INTENT_STATUSES)[number])) {
      throw new BadRequestException({
        error: 'INTENT_NOT_REFUNDABLE',
        message: `결제 완료된 주문만 환불 신청할 수 있습니다: ${intent.status}`,
      });
    }

    // 무통장(가상계좌) charge 만 이 경로의 대상. 카드 등은 별도 환불.
    const charge = await this.chargesService.findSucceededAuthorizeByIntent(intentId);
    if (!charge) throw new BadRequestException({ error: 'REFUNDABLE_CHARGE_NOT_FOUND' });
    const method = await this.dbService.db
      .select({ type: paymentMethods.type })
      .from(paymentMethods)
      .where(eq(paymentMethods.id, charge.paymentMethodId))
      .limit(1)
      .then((r) => r[0]);
    if (method?.type !== 'BANK_TRANSFER') {
      throw new BadRequestException({
        error: 'NOT_BANK_TRANSFER',
        message: '무통장입금 주문만 환불 계좌 신청이 필요합니다.',
      });
    }

    try {
      const inserted = await this.dbService.db
        .insert(refundRequests)
        .values({
          intentId,
          chargeId: charge.id,
          userId,
          amount: charge.amount,
          currency: charge.currency,
          bankCode: input.bankCode,
          bankName: input.bankName ?? null,
          accountNumber: input.accountNumber.replace(/[^0-9]/g, ''),
          holderName: input.holderName,
          status: 'REQUESTED',
          reason: input.reason ?? null,
        })
        .returning();
      return inserted[0]!;
    } catch (e) {
      // uq_refund_requests_intent_active: 대기중 요청 중복 방지
      throw new ConflictException({
        error: 'REFUND_REQUEST_ALREADY_EXISTS',
        message: '이미 처리 대기 중인 환불 요청이 있습니다.',
      });
    }
  }

  /**
   * 고객: 해당 intent 의 재신청을 막아야 하는 환불 요청. 없으면 null.
   * - REQUESTED: 처리 대기중 → 주문내역 '환불 신청됨'
   * - APPROVED: 환불 완료 → 주문내역 '환불 완료' (재신청 불가)
   * REJECTED/CANCELED 는 무시 → 고객이 재신청 가능.
   */
  async findActiveByIntent(intentId: string, userId: string): Promise<RefundRequest | null> {
    const rows = await this.dbService.db
      .select()
      .from(refundRequests)
      .where(
        and(
          eq(refundRequests.intentId, intentId),
          eq(refundRequests.userId, userId),
          inArray(refundRequests.status, ['REQUESTED', 'APPROVED']),
        ),
      )
      .orderBy(desc(refundRequests.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 관리자: 대기(REQUESTED) 환불 요청 목록. */
  async listPending(page = 1, limit = 20): Promise<PaginatedResponseDto<RefundRequest>> {
    const db = this.dbService.db;
    const offset = (page - 1) * limit;
    const [countRow] = await db
      .select({ value: count() })
      .from(refundRequests)
      .where(eq(refundRequests.status, 'REQUESTED'));
    const data = await db
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.status, 'REQUESTED'))
      .orderBy(desc(refundRequests.createdAt))
      .limit(limit)
      .offset(offset);
    return { data, total: countRow?.value ?? 0, page, limit };
  }

  /** 관리자 승인: 저장된 환불계좌로 실제 환불(토스 자동 송금 + 현금영수증 취소) 실행. */
  async approve(id: string, adminId: string, adminNote?: string): Promise<RefundRequest> {
    const req = await this.loadRequestable(id);

    const refund = await this.refundsService.create({
      chargeId: req.chargeId,
      intentId: req.intentId,
      amount: req.amount,
      reasonCode: 'CUSTOMER_REFUND_REQUEST',
      reasonMessage: req.reason ?? undefined,
      allowMembershipRefund: true,
      refundReceiveAccount: {
        bank: req.bankCode,
        accountNumber: req.accountNumber,
        holderName: req.holderName,
      },
    });

    const updated = await this.dbService.db
      .update(refundRequests)
      .set({
        status: 'APPROVED',
        refundId: refund.id,
        processedBy: adminId,
        processedAt: new Date(),
        adminNote: adminNote ?? null,
        updatedAt: new Date(),
      })
      .where(eq(refundRequests.id, id))
      .returning();
    this.logger.log(`refund request approved: id=${id} refundId=${refund.id} status=${refund.status}`);
    return updated[0]!;
  }

  /** 관리자 거절. */
  async reject(id: string, adminId: string, adminNote?: string): Promise<RefundRequest> {
    await this.loadRequestable(id);
    const updated = await this.dbService.db
      .update(refundRequests)
      .set({ status: 'REJECTED', processedBy: adminId, processedAt: new Date(), adminNote: adminNote ?? null, updatedAt: new Date() })
      .where(eq(refundRequests.id, id))
      .returning();
    return updated[0]!;
  }

  private async loadRequestable(id: string): Promise<RefundRequest> {
    const req = await this.dbService.db
      .select()
      .from(refundRequests)
      .where(and(eq(refundRequests.id, id), eq(refundRequests.status, 'REQUESTED')))
      .limit(1)
      .then((r) => r[0]);
    if (!req) {
      throw new NotFoundException({ error: 'REFUND_REQUEST_NOT_FOUND', message: '대기 중인 환불 요청이 없습니다.' });
    }
    return req;
  }
}
