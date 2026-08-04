import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { WalletSchema, billingAgreements } from '../schema';
import { BillingAgreement } from '../types';
import { BillingMethodService } from './billing-method.service';

@Injectable()
export class BillingAgreementService {
  private readonly logger = new Logger(BillingAgreementService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly billingMethodService: BillingMethodService,
  ) {}

  async create(
    userId: string,
    billingMethodId: string,
    subscriberRef: string,
    subscriberType: string,
    opts?: { allowPendingMandate?: boolean },
  ): Promise<BillingAgreement> {
    await this.billingMethodService.assertSelectableForRecurringBilling(userId, billingMethodId, opts);

    // subscriberRef(=계약 id)는 계약당 재사용된다. 정기결제 해지가 남긴 REVOKED 행이
    // uq_billing_agreements_subscriber (subscriber_type, subscriber_ref) 비-partial 유니크 인덱스와 충돌해
    // 평범한 INSERT 는 유니크 위반(→500)이 된다. 같은 subscriber 조합이 있으면 그 행을 ACTIVE 로 되살리는
    // upsert 로 처리해 관리자 자동갱신 재활성(같은 계약 id 재사용)을 지원한다.
    const rows = await this.dbService.db
      .insert(billingAgreements)
      .values({
        userId,
        billingMethodId,
        subscriberRef,
        subscriberType,
        status: 'ACTIVE',
      })
      .onConflictDoUpdate({
        target: [billingAgreements.subscriberType, billingAgreements.subscriberRef],
        set: { userId, billingMethodId, status: 'ACTIVE', updatedAt: new Date() },
      })
      .returning();

    return rows[0];
  }

  /**
   * 서버 간 호출용 — 유저의 가장 최근 ACTIVE billing_method로 agreement를 생성하거나 기존 것을 반환.
   * subscriberRef+subscriberType 조합이 이미 존재하면 최신 billing_method로 업데이트.
   */
  async createWithAutoMethod(userId: string, subscriberRef: string, subscriberType: string): Promise<BillingAgreement> {
    const [billingMethod, existing] = await Promise.all([
      this.billingMethodService.findLatestSelectableForRecurringBilling(userId),
      this.findBySubscriberRef(subscriberType, subscriberRef),
    ]);

    if (!billingMethod) {
      throw new Error(`no selectable billing method found for user: ${userId}`);
    }

    const billingMethodId = billingMethod.id;
    if (existing) {
      if (existing.billingMethodId !== billingMethodId) {
        await this.updateBillingMethod(existing.id, billingMethodId, userId);
        return { ...existing, billingMethodId };
      }
      return existing;
    }

    return this.create(userId, billingMethodId, subscriberRef, subscriberType);
  }

  async findBySubscriberRef(subscriberType: string, subscriberRef: string): Promise<BillingAgreement | undefined> {
    const rows = await this.dbService.db
      .select()
      .from(billingAgreements)
      .where(
        and(
          eq(billingAgreements.subscriberType, subscriberType),
          eq(billingAgreements.subscriberRef, subscriberRef),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findByUserId(userId: string): Promise<BillingAgreement[]> {
    return this.dbService.db
      .select()
      .from(billingAgreements)
      .where(and(eq(billingAgreements.userId, userId), eq(billingAgreements.status, 'ACTIVE')));
  }

  async updateBillingMethod(agreementId: string, newBillingMethodId: string, userId: string): Promise<void> {
    await this.billingMethodService.assertSelectableForRecurringBilling(userId, newBillingMethodId);

    // Update only if the agreement belongs to userId
    const rows = await this.dbService.db
      .update(billingAgreements)
      .set({ billingMethodId: newBillingMethodId, updatedAt: new Date() })
      .where(
        and(
          eq(billingAgreements.id, agreementId),
          eq(billingAgreements.userId, userId),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      )
      .returning({ id: billingAgreements.id });

    if (rows.length === 0) {
      throw new Error('billing agreement not found or inactive');
    }
  }

  async revoke(agreementId: string, userId: string): Promise<void> {
    const rows = await this.dbService.db
      .update(billingAgreements)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(billingAgreements.id, agreementId),
          eq(billingAgreements.userId, userId),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      )
      .returning({ id: billingAgreements.id });

    if (rows.length === 0) {
      throw new Error('billing agreement not found or already inactive');
    }
  }

  async revokeBySubscriberRef(subscriberType: string, subscriberRef: string): Promise<void> {
    await this.dbService.db
      .update(billingAgreements)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(billingAgreements.subscriberType, subscriberType),
          eq(billingAgreements.subscriberRef, subscriberRef),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      );
  }

  /**
   * 구독 해지에 따른 자동이체 약정 완전 종료.
   *
   * `revokeBySubscriberRef` 는 wallet 로컬 상태만 REVOKED 로 바꾼다 — 은행에 걸린 효성 CMS 약정은
   * 그대로 살아있다. 효성 프로토콜(FMS-TE-0046)에는 약정해지 API 가 없고 **회원삭제**(DELETE
   * /v1/members/{memberId})가 유일한 종료 수단이므로, 여기서 그 경로까지 이어준다.
   *
   * 순서가 중요하다:
   *  1) 아직 출금되지 않은 예정 출금을 먼저 삭제한다 — CMS 는 환불 API 가 없어서, 일단 나가면
   *     돌려주는 방법이 수동 송금뿐이다. 마감 전 취소가 유일하게 깔끔한 회수다.
   *  2) 약정 행을 REVOKED 로 내린다.
   *  3) 그 결제수단을 쓰는 **다른 활성 약정이 없을 때만** 효성 회원을 삭제한다. 결제수단은
   *     사용자당 공유되므로, 남은 구독이 있으면 지우면 그 구독의 청구가 깨진다.
   */
  /**
   * @param deleteBillingMethod 등록된 자동이체 계좌(효성 회원)까지 지울지.
   *   기본은 **남긴다** — 출금은 우리가 요청할 때만 일어나므로 계좌를 남겨도 돈은 나가지 않고,
   *   재가입할 때 같은 계좌를 은행 재심사 없이 바로 쓸 수 있다. 고객이 출금동의 철회까지 원하면
   *   true 로 부른다(그 경우에만 효성 회원삭제).
   */
  async terminateMandateBySubscriberRef(
    subscriberType: string,
    subscriberRef: string,
    deleteBillingMethod = false,
  ): Promise<{
    agreementFound: boolean;
    cancelledWithdrawals: number;
    mandateTerminated: boolean;
    /** 요청에 따라 계좌를 남겼는지. 남긴 건 '정리 실패' 가 아니므로 재시도 대상이 아니다. */
    billingMethodKept: boolean;
    skipReason?: string;
  }> {
    const [agreement] = await this.dbService.db
      .select()
      .from(billingAgreements)
      .where(
        and(
          eq(billingAgreements.subscriberType, subscriberType),
          eq(billingAgreements.subscriberRef, subscriberRef),
        ),
      )
      .limit(1);

    if (!agreement) {
      return { agreementFound: false, cancelledWithdrawals: 0, mandateTerminated: false, billingMethodKept: false };
    }

    // 1) 마감 전 예정 출금 취소 (돈이 나가는 것을 애초에 막는다)
    const cancelledWithdrawals = await this.billingMethodService.cancelPendingCmsWithdrawals(
      agreement.billingMethodId,
    );

    // 2) 약정 비활성화
    if (agreement.status === 'ACTIVE') {
      await this.revokeBySubscriberRef(subscriberType, subscriberRef);
    }

    // 3) 같은 결제수단을 쓰는 다른 활성 약정이 남아있으면 효성 회원은 지우지 않는다
    const others = await this.dbService.db
      .select({ id: billingAgreements.id })
      .from(billingAgreements)
      .where(
        and(
          eq(billingAgreements.billingMethodId, agreement.billingMethodId),
          eq(billingAgreements.status, 'ACTIVE'),
        ),
      );

    if (others.length > 0) {
      return {
        agreementFound: true,
        cancelledWithdrawals,
        mandateTerminated: false,
        billingMethodKept: true,
        skipReason: 'BILLING_METHOD_IN_USE_BY_OTHER_AGREEMENT',
      };
    }

    // 계좌를 남기는 것이 기본이다. 예정 출금이 지워지고 약정이 REVOKED 면 더 이상 출금되지 않는다 —
    // 효성 회원삭제는 '은행에 남은 등록까지 지우는' 추가 조치이지 돈을 막는 수단이 아니다.
    if (!deleteBillingMethod) {
      return {
        agreementFound: true,
        cancelledWithdrawals,
        mandateTerminated: false,
        billingMethodKept: true,
        skipReason: 'BILLING_METHOD_KEPT_BY_REQUEST',
      };
    }

    try {
      await this.billingMethodService.revoke(agreement.billingMethodId, agreement.userId);
      return { agreementFound: true, cancelledWithdrawals, mandateTerminated: true, billingMethodKept: false };
    } catch (error) {
      // 이미 삭제된 수단이거나 효성 삭제 가드(CMS_MEMBER_DELETE_BLOCKED_REGISTERED)에 걸린 경우.
      // 구독 해지 자체는 되돌리지 않고, 약정 정리만 후속 처리 대상으로 남긴다.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `CMS 약정 종료 실패 (subscriber=${subscriberType}:${subscriberRef}, billingMethod=${agreement.billingMethodId}): ${message}`,
      );
      return {
        agreementFound: true,
        cancelledWithdrawals,
        mandateTerminated: false,
        billingMethodKept: false,
        skipReason: message,
      };
    }
  }
}
