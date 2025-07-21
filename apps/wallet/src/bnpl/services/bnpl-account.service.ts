import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { BnplPaymentMethodRegisteredEvent } from '../../payment-method/events/bnpl-payment-method-registered.event';
import { newMemberId } from '../../shared/schemas/schema';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm'; // eq (equals) 연산자를 import 합니다.

@Injectable()
export class BnplAccountService {
  private readonly logger = new Logger(BnplAccountService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  async createFromEvent(
    event: BnplPaymentMethodRegisteredEvent,
  ): Promise<void> {
    this.logger.log(
      `이벤트 수신: ${event.userId}에 대한 BNPL 계정 생성을 시도합니다.`,
    );

    try {
      await this.dbService.db.transaction(async (tx) => {
        // 1. ✅ 해당 userId로 BNPL 계정이 이미 존재하는지 먼저 확인합니다.
        const existingAccount = await tx.query.bnplAccount.findFirst({
          where: eq(schema.bnplAccount.userId, event.userId),
        });

        // 2. ✅ 이미 계정이 있다면, 아무것도 하지 않고 함수를 종료합니다.
        if (existingAccount) {
          this.logger.log(
            `사용자 ${event.userId}의 BNPL 계정이 이미 존재하므로 생성을 건너뜁니다. Account ID: ${existingAccount.id}`,
          );
          // TODO: 필요하다면, 기존 계정에 새로운 paymentMethodId를 연결하는 로직을 추가할 수 있습니다.
          return;
        }

        // 3. ✅ 계정이 없을 때만 새로 생성하는 로직을 실행합니다.
        const [newAccount] = await tx
          .insert(schema.bnplAccount)
          .values({
            id: newMemberId(),
            userId: event.userId,
            paymentMethodId: event.paymentMethodId,
            creditLimit: event.creditLimit,
            approvedLimit: event.approvedLimit,
            billingCycleDay: event.billingCycleDay,
            status: 'ACTIVE',
          })
          .returning();

        this.logger.log(`BNPL 계정 생성 완료: ${newAccount.id}`);

        await tx.insert(schema.bnplActivationEvent).values({
          id: ulid(),
          paymentMethodId: newAccount.paymentMethodId,
          bnplAccountId: newAccount.id,
          eventType: 'ACTIVATED',
          actor: 'SYSTEM',
        });

        this.logger.log(
          `BNPL 활성화 이벤트 기록 완료: BNPL Account ID ${newAccount.id}`,
        );
      });
    } catch (error) {
      this.logger.error(
        `${event.paymentMethodId}에 대한 BNPL 계정 생성 트랜잭션 실패`,
        error,
      );
    }
  }
}
