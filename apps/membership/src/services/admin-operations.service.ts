import { Injectable } from '@nestjs/common';
import { PlanService } from './plan.service';
import { SubscriptionService } from './subscription.service';
import { SubscriptionCancellationService } from './subscription-cancellation.service';
import { EntitlementService } from './entitlement.service';
import { PauseService } from './pause.service';
import { AdminMembersReader, AdminMembersQuery, BillingEventItem, AdminBillingHistoryQuery } from './admin/admin-members.reader';
import { PaymentClientService } from './billing/payment-client.service';
import { RecurringBillingService } from './billing/recurring-billing.service';
import {
  CreateTierRequest,
  UpdateTierRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  DeactivatePlanRequest,
  ExtendEntitlementRequest,
} from '../shared/schemas';

/**
 * 관리자용 오케스트레이션 서비스 (Business Layer)
 *
 * 역할: 관리자 작업을 위한 서비스 오케스트레이션
 * - 각 도메인 서비스를 호출하여 관리자 작업 수행
 * - 자체 비즈니스 로직 최소화
 * - 각 서비스에 역할 위임
 *
 * 참고: 이 서비스는 이미 올바른 패턴을 따르고 있습니다.
 */
@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly planService: PlanService,
    private readonly subscriptionService: SubscriptionService,
    private readonly cancellationService: SubscriptionCancellationService,
    private readonly entitlementService: EntitlementService,
    private readonly pauseService: PauseService,
    private readonly adminMembersReader: AdminMembersReader,
    private readonly paymentClientService: PaymentClientService,
    private readonly recurringBillingService: RecurringBillingService,
  ) {}

  // =================================================================
  // Plan & Tier Management
  // =================================================================

  async createTier(dto: CreateTierRequest, adminId: string) {
    // PlanService의 createTier 메소드를 직접 호출합니다.
    // 유효성 검사 및 DB 작업은 PlanService가 책임집니다.
    return this.planService.createTier(dto, adminId);
  }

  async updateTier(tierId: string, dto: UpdateTierRequest, adminId: string) {
    return this.planService.updateTier(tierId, dto, adminId);
  }

  async createPlan(dto: CreatePlanRequest, adminId: string) {
    return this.planService.createPlan(dto, adminId);
  }

  async updatePlan(planId: string, dto: UpdatePlanRequest, adminId: string) {
    return this.planService.updatePlan(planId, dto, adminId);
  }

  async deactivatePlan(planId: string, dto: DeactivatePlanRequest, adminId: string) {
    return this.planService.deactivatePlan(planId, dto.reason, adminId);
  }

  async activatePlan(planId: string, adminId: string) {
    return this.planService.activatePlan(planId, adminId);
  }

  async adminSubscribeUser(userId: string, planId: string, billingMode: 'one_time' | 'recurring') {
    return this.subscriptionService.adminCreateSubscription(userId, planId, billingMode);
  }

  async retryBillingForContract(contractId: string) {
    return this.recurringBillingService.retryContractBilling(contractId);
  }

  async getAllTiersWithPlans() {
    return this.planService.getAllTiersWithPlans();
  }

  // =================================================================
  // Policy Management
  // =================================================================

  // =================================================================
  // User & Subscription Management (필요 시 추가)
  // =================================================================

  /**
   * 강제 구독 취소 (관리자 전용)
   *
   * ✅ 흐름만 표현: "CancellationService 호출"
   */
  async forceCancelSubscription(
    contractId: string,
    adminId: string,
    reason: string,
    refundType: 'FULL' | 'PARTIAL' | 'NONE',
    partialRefundAmount?: number,
    refundReason?: string,
  ) {
    return this.cancellationService.forceCancelSubscription(
      contractId,
      adminId,
      reason,
      refundType,
      partialRefundAmount,
      refundReason,
    );
  }

  // =================================================================
  // Entitlement Management - 구독 권한 관리
  // =================================================================

  /**
   * 사용자의 구독 기간을 연장하거나 차감합니다.
   * @param dto - 구독 기간 조정 요청 데이터
   * @param adminId - 관리자 ID
   */
  async adjustUserEntitlement(dto: ExtendEntitlementRequest, adminId: string) {
    return await this.entitlementService.adjustEntitlement(dto.userId, dto.days, dto.reason, adminId);
  }

  /**
   * 사용자의 일시정지 이력을 조회합니다.
   *
   * ✅ 흐름만 표현: "일시정지 이력 조회"
   */
  async getUserPauseHistory(userId: string) {
    return this.pauseService.getPauseHistory(userId);
  }

  /**
   * 관리자 멤버십 회원 목록 조회 (페이지네이션 + 필터)
   */
  async getMembersList(query: AdminMembersQuery) {
    return this.adminMembersReader.findAllWithDetails(query);
  }

  async getMemberDetail(userId: string) {
    return this.adminMembersReader.findDetailByUserId(userId);
  }

  async getMemberBillingEvents(contractId: string): Promise<BillingEventItem[]> {
    const events = await this.adminMembersReader.findBillingEventsByContractId(contractId);

    // 신규 구독은 최초 결제가 billing_events에 직접 기록됨 → wallet 조회 불필요
    if (events.some((e) => e.attemptNo === 1)) return events;

    // 구버전 데이터 호환: lastPaymentIntentId로 wallet에서 최초 결제 조회
    const paymentRef = await this.adminMembersReader.findContractPaymentRef(contractId);
    if (!paymentRef?.lastPaymentIntentId) return events;

    try {
      const intent = await this.paymentClientService.getWalletPaymentIntent(paymentRef.lastPaymentIntentId);
      const succeeded = intent.status === 'AUTHORIZED' || intent.status === 'CAPTURED';
      const initialEvent: BillingEventItem = {
        id: intent.id,
        contractId,
        eventType: succeeded ? 'CHARGE_SUCCESS' : intent.status === 'FAILED' ? 'CHARGE_FAIL' : 'CHARGE_ATTEMPT',
        attemptNo: 1,
        amount: intent.payableAmount ?? null,
        errorCode: null,
        errorMessage: null,
        createdAt: intent.createdAt,
      };
      return [initialEvent, ...events];
    } catch {
      return events;
    }
  }

  async getMemberContractEvents(contractId: string) {
    return this.adminMembersReader.findContractEventsByContractId(contractId);
  }

  async setAutoRenewal(contractId: string, autoRenewal: boolean, adminId: string) {
    return this.adminMembersReader.updateAutoRenewal(contractId, autoRenewal, adminId);
  }

  async getAllBillingHistory(query: AdminBillingHistoryQuery) {
    return this.adminMembersReader.findAllBillingHistory(query);
  }
}
