import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { EventPayloadOf } from '@packages/event-contracts/types';
import { SubscriptionCancellationService } from '../services/subscription-cancellation.service';
import { SubscriptionContractReader } from '../services/subscription/subscription-contract.reader';

/** `event_batches.admin_id` 에 남길 표식. 사람이 아니라 탈퇴 처리가 해지했음을 감사 기록에 남긴다. */
const SYSTEM_ACTOR = 'SYSTEM_USER_WITHDRAWAL';

const CANCEL_REASON = '회원 탈퇴';

/**
 * 회원 탈퇴 → 멤버십 구독 해지.
 *
 * 이 컨슈머가 없던 동안 탈퇴한 회원의 정기결제가 그대로 살아 있었다 — 계약이 ACTIVE 로 남아
 * 스케줄러가 계속 청구했고, 효성 CMS 약정은 은행에 등록된 채였다. 탈퇴 화면은 "멤버십 혜택은
 * 모두 즉시 소멸됩니다" 라고 안내한다.
 *
 * **환불은 집행하지 않는다.** 이용약관 제20조 ② 의 정산 환급은 "해지" 창구의 몫이고, 그 창구는
 * 환불 방식·수취 계좌를 고객에게 묻는다. 탈퇴 화면에는 그 자리가 없어서, 여기서 환불을 시작하면
 * 효성 CMS·무통장 건은 보낼 곳 없는 수동 대기로만 쌓인다.
 *
 * 그래서 역할을 나눴다 — **탈퇴는 이후 자동결제를 끊는 데까지만 책임진다.** 환불을 원하는 고객은
 * 탈퇴 전에 멤버십 해지를 거치도록 탈퇴 화면이 안내한다(`mypage.account.withdraw.membershipNotice`).
 *
 * 계좌는 지운다(`deleteBillingMethod: true`). 탈퇴는 개인정보 파기를 포함하므로 자동이체 계좌를
 * 남길 근거가 없다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class UserWithdrawalConsumer {
  private readonly logger = new Logger(UserWithdrawalConsumer.name);

  constructor(
    private readonly cancellationService: SubscriptionCancellationService,
    private readonly contractReader: SubscriptionContractReader,
  ) {}

  @On(USER_STREAM, 'UserDeleted')
  async onUserDeleted(@EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserDeleted'>) {
    const { userId } = payload;
    if (!userId) return;

    const contracts = await this.contractReader.findContractsByUserId(userId);
    // 이미 해지된 계약은 건너뛴다 — 재시도로 이 핸들러가 다시 돌아도 같은 계약을 두 번 취소하지
    // 않는다(멱등). 남은 상태는 매번 DB 에서 다시 읽으므로 부분 성공 뒤 재시도도 안전하다.
    const targets = contracts.filter((c) => c.status !== 'CANCELLED');

    if (targets.length === 0) {
      this.logger.log(`[UserWithdrawal] 해지할 구독 없음: userId=${userId}`);
      return;
    }

    const failed: string[] = [];

    for (const contract of targets) {
      try {
        await this.cancellationService.forceCancelSubscription(
          contract.id,
          SYSTEM_ACTOR,
          CANCEL_REASON,
          'NONE',
          undefined,
          undefined,
          undefined,
          false,
          // 안내 메일 주소를 넘기지 않는다 — 탈퇴로 이미 개인정보를 파기했다.
          undefined,
          true,
        );

        this.logger.log(`[UserWithdrawal] 구독 해지 완료: userId=${userId} contractId=${contract.id}`);
      } catch (error) {
        failed.push(contract.id);
        this.logger.error(
          `[UserWithdrawal] 구독 해지 실패: userId=${userId} contractId=${contract.id} — ${(error as Error).message}`,
        );
      }
    }

    // 하나라도 실패하면 던진다. 청구가 살아 있는 채로 조용히 넘어가면 탈퇴한 고객에게 계속
    // 출금된다 — 재시도/DLQ 로 반드시 사람 눈에 띄게 한다.
    if (failed.length > 0) {
      throw new Error(`멤버십 해지 실패 userId=${userId} contractIds=${failed.join(',')}`);
    }
  }
}
