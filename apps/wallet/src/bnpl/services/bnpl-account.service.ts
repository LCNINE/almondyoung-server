import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { BnplPaymentMethodRegisteredEvent } from '../../payment-method/events/bnpl-payment-method-registered.event';
import { newMemberId } from '../../shared/schemas/schema';

/**
 * BNPL 계정(BnplAccount) 도메인 서비스
 * - 역할: BNPL 계정의 생성 및 관리를 책임집니다.
 */
@Injectable()
export class BnplAccountService {
  private readonly logger = new Logger(BnplAccountService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 'bnpl.method.registered' 이벤트를 받아 BNPL 계정을 생성합니다.
   * @param event 결제수단 등록 이벤트 페이로드
   */
  async createFromEvent(
    event: BnplPaymentMethodRegisteredEvent,
  ): Promise<void> {
    this.logger.log(
      `이벤트 수신: ${event.paymentMethodId}에 대한 BNPL 계정 생성을 시작합니다.`,
    );

    try {
      // 이벤트로부터 받은 데이터로 bnplAccount를 생성합니다.
      const [newAccount] = await this.dbService.db
        .insert(schema.bnplAccount)
        .values({
          id: newMemberId(), // ✅ BNPL 계정의 고유 ID를 새로 생성합니다.
          userId: event.userId,
          paymentMethodId: event.paymentMethodId,
          creditLimit: event.creditLimit,
          approvedLimit: event.approvedLimit,
          billingCycleDay: event.billingCycleDay,
          status: 'ACTIVE', // 계정은 생성 즉시 활성 상태가 됩니다.
        })
        .returning();

      this.logger.log(`BNPL 계정 생성 완료: ${newAccount.id}`);
    } catch (error) {
      this.logger.error(
        `${event.paymentMethodId}에 대한 BNPL 계정 생성 실패`,
        error,
      );
      // TODO: 실패 시 에러 처리 로직 (예: 슬랙 알림, 재시도 큐에 적재 등)
    }
  }
}
