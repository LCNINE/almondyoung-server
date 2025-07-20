import { Injectable, Logger } from '@nestjs/common';
import { BnplAccountService } from './services/bnpl-account.service';
import { HmsBnplService } from './services/hms-bnpl.service';
import { BnplSettlementService } from './services/bnpl-settlement.service';
import { BnplCreditService } from './services/bnpl-credit.service';
import { BatchCmsStatusTrackerService } from './services/batch-cms-status-tracker.service';
import { PgPort } from '../payment/ports/pg.port';
import { sumDecimalStrings } from '../payment/utils/money.utils';
import { BnplPaymentService } from './services/bnpl-payment.service';
import { BnplTransactionService } from './services/bnpl-transaction.service';
import { MonthlyStatementService } from './services/monthly-statement.service';
import { EventProcessorService } from '../shared/events/event-processor.service';
import { BnplPaymentRequestedEvent } from './events/bnpl.events';
import { CreateMemberResponseDto } from 'hms-api-wrapper/dist/services/BatchCms/types';
import * as bnplZod from '../shared/zod/bnpl.zod';
import * as paymentZod from '../shared/zod/payment.zod';
import { ulid } from 'ulid';
/**
 * BNPL 서비스 - Orchestrator/Facade 패턴
 *
 * 주요 역할:
 * 1. 복잡한 비즈니스 프로세스 조율
 * 2. 여러 서비스 간의 트랜잭션 관리
 * 3. 외부 API(HMS)와 내부 DB 작업 조율
 * 4. 통합된 에러 처리
 */
@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);

  constructor(
    private readonly accountService: BnplAccountService,
    private readonly creditService: BnplCreditService,
    private readonly settlementService: BnplSettlementService,
    private readonly hmsBnplService: HmsBnplService,
    private readonly batchCmsStatusTracker: BatchCmsStatusTrackerService,
    private readonly pgPort: PgPort, // PG 어댑터 주입
    private readonly bnplPaymentService: BnplPaymentService,
    private readonly bnplTransactionService: BnplTransactionService,
    private readonly monthlyStatementService: MonthlyStatementService,
    private readonly eventProcessor: EventProcessorService,
  ) {
    this.logger.log('🚀 BNPL 서비스 초기화 완료 (하이브리드 결제 지원)');
  }

  /**
   * BNPL 계좌 등록 - 이제 이벤트 기반으로 처리됨
   * 
   * 참고: 실제 계좌 생성은 PaymentMethod에서 BatchCmsMethodRegisteredEvent를 통해 처리됩니다.
   * 이 메서드는 호환성을 위해 유지되지만, 직접 호출하지 마세요.
   */
  async createBnplAccount(dto: bnplZod.Account.Create): Promise<{
    success: boolean;
    message: string;
    data?: any;
  }> {
    this.logger.warn('createBnplAccount 직접 호출됨. PaymentMethod 이벤트 기반 처리를 권장합니다.');
    
    return {
      success: false,
      message: 'BNPL 계좌는 PaymentMethod 등록을 통해 자동으로 생성됩니다. PaymentMethod를 먼저 등록해주세요.',
    };
  }

  /**
   * BNPL 계좌 비활성화 - 복잡한 프로세스 조율
   *
   * 플로우:
   * 1. 미정산 금액 확인
   * 2. HMS 배치 CMS에서 회원 삭제
   * 3. DB에서 BNPL 계정 비활성화
   * 4. 관련 정산 배치 처리
   */
  async deactivateBnplAccount(dto: bnplZod.Account.UpdateStatus) {
    this.logger.log(`BNPL 계좌 비활성화 시작. accountId: ${dto.bnplAccountId}`);

    try {
      // 1. 계정 정보 조회 및 검증 (accountId로 직접 조회하는 메서드 필요)
      const account = await this.accountService.getAccountById(
        dto.bnplAccountId,
      );
      if (!account) {
        throw new Error('BNPL 계정을 찾을 수 없습니다.');
      }

      // 2. 미정산 정산 배치 확인
      const statistics = await this.settlementService.getSettlementStatistics(
        account.id,
      );
      if (statistics.totalPending > 0) {
        throw new Error(
          `미정산 금액이 ${statistics.totalPending}원 있어 비활성화할 수 없습니다.`,
        );
      }

      // 3. HMS 배치 CMS에서 회원 삭제
      await this.hmsBnplService.deleteMember(account.userId);

      // 4. DB에서 BNPL 계정 비활성화
      await this.accountService.deactivateAccount(dto);

      return {
        success: true,
        message: 'BNPL 계좌가 성공적으로 비활성화되었습니다.',
      };
    } catch (error) {
      this.logger.error(`BNPL 계좌 비활성화 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * BNPL 계좌 정보 조회 - 통합 정보 제공
   */
  // bnpl.service.ts

  async getBnplAccount(
    userId: string,
  ): Promise<bnplZod.Account.Select | null> {
    const account = await this.accountService.getAccountByUserId(userId);

    if (!account) {
      return null;
    }

    // 추가 정보 조합
    const creditInfo = await this.creditService.getAvailableCredit(account.id);
    const statistics = await this.settlementService.getSettlementStatistics(
      account.id,
    );

    // ✅ 확장된 DTO의 모양에 정확히 맞춰서 객체를 만들어 반환
    const responseDto: bnplZod.Account.Select & {
      availableCredit: number;
      lastSettlementDate: Date | null;
    } = {
      // 1. BnplAccountSchema에서 온 필드들
      id: account.id,
      userId: account.userId,
      paymentMethodId: account.paymentMethodId,
      creditLimit: account.creditLimit,
      approvedLimit: account.approvedLimit,
      status: account.status,
      billingCycleDay: account.billingCycleDay,
      termsUrl: account.termsUrl || '',
      version: account.version,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,

      // 2. extraResponseFields에서 온 필드들
      availableCredit: creditInfo.availableCredit,
      lastSettlementDate: statistics.lastSettlementDate,
    };

    return responseDto;
  }
  /**
   * 사용자의 모든 BNPL 계좌 조회
   */
  async getBnplAccounts(userId: string) {
    return this.accountService.getAllAccountsByUserId(userId);
  }

  /**
   * BNPL 이벤트 히스토리 조회
   */
  async getBnplEventHistory(userId: string) {
    return this.accountService.getEventHistory(userId);
  }

  /**
   * BNPL 출금 요청 - PG 어댑터를 통한 처리
   */
  async requestWithdrawal(withdrawalData: any) {
    this.logger.log(
      `BNPL 출금 요청 시작: ${withdrawalData.memberId}, 금액: ${withdrawalData.callAmount || withdrawalData.amount}원`,
    );

    try {
      // 1. PG 어댑터를 통한 출금 요청
      const pgResult = await this.pgPort.charge({
        amount: withdrawalData.callAmount || withdrawalData.amount,
        orderId: withdrawalData.invoiceId,
        memberId: withdrawalData.memberId,
        description: 'BNPL 월별 정산',
        metadata: withdrawalData,
      });

      // 2. 성공 시 payment_event 테이블에 기록
      if (pgResult.status === 'SUCCESS' || pgResult.status === 'PENDING') {
        // BNPL 계정 조회
        const bnplAccount = await this.accountService.getAccountByUserId(
          withdrawalData.memberId,
        );

        if (bnplAccount) {
          // payment 테이블에 기록
          const paymentResult = await this.bnplPaymentService.requestPayment({
            invoiceId: withdrawalData.invoiceId,
            paymentMethodId: bnplAccount.paymentMethodId,
            amount: withdrawalData.callAmount || withdrawalData.amount,
            actor: 'USER',
          });

          this.logger.log(
            `BNPL 출금 요청 payment_event 기록 완료: ${paymentResult.id}`,
          );

          // 결과에 payment 정보 추가
          return {
            success: true,
            transactionId: pgResult.transactionId,
            paymentId: paymentResult.id,
            status: pgResult.status,
            message: 'BNPL 출금 요청 및 이벤트 기록이 완료되었습니다.',
            rawResponse: pgResult.rawResponse,
          };
        }
      }

      return {
        success: pgResult.status === 'SUCCESS' || pgResult.status === 'PENDING',
        transactionId: pgResult.transactionId,
        status: pgResult.status,
        message: pgResult.message || 'BNPL 출금 요청 처리 완료',
        rawResponse: pgResult.rawResponse,
      };
    } catch (error) {
      this.logger.error(`BNPL 출금 요청 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * BNPL 상태 확인 (목업서버 연결 테스트)
   */
  async checkBnplHealth() {
    const hmsHealth = await this.hmsBnplService.checkHealth();

    // 추가 상태 정보
    return {
      ...hmsHealth,
      services: {
        hms: hmsHealth.status,
        database: 'ok', // TODO: 실제 DB 연결 확인
        scheduler: 'ok', // TODO: 스케줄러 상태 확인
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * BNPL 동의자료 제출
   *
   * 플로우:
   * 1. HMS 배치 CMS에 동의자료 제출
   * 2. 성공 시 응답 반환
   */
  async submitAgreement(
    data: any & {
      agreementFile: {
        filename: string;
        mimetype: string;
        value: Buffer;
      };
    },
  ) {
    this.logger.log(`BNPL 동의자료 제출 시작. memberId: ${data.memberId}`);

    try {
      // 1. HmsBnplService로 원시 데이터만 전달
      const result = await this.hmsBnplService.submitAgreement({
        memberId: data.memberId,
        custId: data.custId || 'default-cust',
        agreementText: data.agreementText,
        filename: data.agreementFile.filename,
        mimetype: data.agreementFile.mimetype,
        buffer: data.agreementFile.value,
      });

      this.logger.log(
        `BNPL 동의자료 제출 완료: ${result.agreementFile?.agreementKey}`,
      );

      return {
        success: true,
        agreementKey: result.agreementFile?.agreementKey,
        message: '동의자료가 성공적으로 제출되었습니다.',
        result,
      };
    } catch (error) {
      this.logger.error(`BNPL 동의자료 제출 실패: ${error.message}`);
      throw error;
    }
  }
  /**
   * 대시보드용 통계 정보 (추가 기능)
   */
  async getDashboardStatistics(userId: string) {
    const account = await this.accountService.getAccountByUserId(userId);
    if (!account) {
      return null;
    }

    // 여러 서비스에서 정보 조합
    const [creditInfo, riskAssessment, settlementStats, accountStats] =
      await Promise.all([
        this.creditService.getAvailableCredit(account.id),
        this.creditService.evaluateRisk(account.id),
        this.settlementService.getSettlementStatistics(account.id),
        this.accountService.getAccountStatistics(account.id),
      ]);

    return {
      account: {
        id: account.id,
        status: account.status,
        billingCycleDay: account.billingCycleDay,
      },
      credit: creditInfo,
      risk: riskAssessment,
      settlement: settlementStats,
      transactions: accountStats,
    };
  }

  /**
   * 월별 청구서 생성 (추가 기능)
   */
  async generateMonthlyStatement(accountId: string, month: string) {
    const [batches, transactions] = await Promise.all([
      this.settlementService.getSettlementBatchStatus(accountId, month),
      this.accountService.getTransactionHistory(accountId, 100),
    ]);

    const monthTransactions = transactions.filter((tx: any) => {
      const txMonth = tx.createdAt.toISOString().slice(0, 7);
      return txMonth === month;
    });

    return {
      month,
      transactions: monthTransactions,
      settlementBatch: batches[0] || null,
      summary: {
        totalDebits: sumDecimalStrings(
          monthTransactions
            .filter((tx: any) => tx.transactionType === 'DEBIT')
            .map((tx: any) => tx.amount),
        ),
        totalCredits: sumDecimalStrings(
          monthTransactions
            .filter((tx: any) => tx.transactionType === 'CREDIT')
            .map((tx: any) => tx.amount),
        ),
        transactionCount: monthTransactions.length,
      },
    };
  }

  /**
   * BNPL 결제 요청 처리 (하이브리드 승인 시스템)
   *
   * 플로우:
   * 1. BatchCMS 상태 확인
   * 2. 승인 방식 결정 (정규 vs 임시)
   * 3. PaymentEvent 생성 및 BnplTransaction 생성
   * 4. 월별명세서에 추가
   */
  async requestPayment(dto: bnplZod.Payment['Request']) {
    this.logger.log(
      `BNPL 결제 요청 시작: ${dto.invoiceId || 'N/A'}, 금액: ${dto.amount}원`,
    );

    try {
      // 1단계: 결제 승인 방식 결정
      const approvalResult = await this.approvePayment({
        accountId: dto.accountId,
        invoiceId: dto.invoiceId || `INV_${ulid()}`,
        amount: dto.amount,
        description: dto.description,
      });

      if (!approvalResult.success) {
        throw new Error(approvalResult.message);
      }

      this.logger.log(`BNPL 결제 승인 완료: ${approvalResult.approvalMethod} 방식`);

      return {
        success: true,
        paymentId: approvalResult.paymentEventId,
        transactionId: approvalResult.transactionId,
        approvalMethod: approvalResult.approvalMethod,
        message: approvalResult.message,
      };

    } catch (error) {
      this.logger.error(`BNPL 결제 요청 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * BNPL 결제 승인 처리 (핵심 하이브리드 로직)
   */
  async approvePayment(request: {
    accountId: string;
    invoiceId: string;
    amount: number;
    description?: string;
  }): Promise<{
    success: boolean;
    paymentEventId: string;
    transactionId: string;
    approvalMethod: 'BATCH_CMS' | 'INTERNAL_CREDIT';
    message: string;
  }> {
    this.logger.log(`BNPL 결제 승인 시작: ${request.accountId}, 금액: ${request.amount}`);

    try {
      // 1. BNPL 계정 조회
      const account = await this.accountService.getAccountById(request.accountId);
      if (!account) {
        throw new Error('BNPL 계정을 찾을 수 없습니다.');
      }

      // 2. BatchCMS 상태 확인
      const batchCmsStatus = await this.checkBatchCmsStatus(account.paymentMethodId);
      
      // 3. 승인 방식 결정 및 처리
      if (batchCmsStatus.status === 'APPROVED') {
        // 정규 결제 방식 (BatchCMS 등록 완료)
        return await this.processRegularPayment(account, request);
      } else {
        // 임시 결제 방식 (내부 신용도 기반)
        return await this.processTemporaryPayment(account, request);
      }

    } catch (error) {
      this.logger.error(`BNPL 결제 승인 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * BatchCMS 상태 확인
   */
  async checkBatchCmsStatus(paymentMethodId: string): Promise<{
    status: string;
    daysElapsed: number;
  }> {
    try {
      return await this.batchCmsStatusTracker.checkRegistrationStatus(paymentMethodId);
    } catch (error) {
      this.logger.error(`BatchCMS 상태 확인 실패: ${error.message}`);
      // 기본값으로 PENDING 반환
      return {
        status: 'PENDING',
        daysElapsed: 0,
      };
    }
  }

  /**
   * 정규 결제 처리 (BatchCMS 등록 완료)
   */
  private async processRegularPayment(
    account: any,
    request: { accountId: string; invoiceId: string; amount: number; description?: string; }
  ) {
    this.logger.log(`정규 결제 처리: ${request.accountId}`);

    // PaymentEvent 생성
    const paymentEvent = await this.bnplPaymentService.requestPayment({
      invoiceId: request.invoiceId,
      paymentMethodId: account.paymentMethodId,
      amount: request.amount,
      actor: 'USER',
    });

    // BnplTransaction 생성 (정규)
    const transaction = await this.bnplTransactionService.createTransaction({
      bnplAccountId: account.id,
      invoiceId: request.invoiceId,
      transactionType: 'DEBIT',
      status: 'AUTHORIZED',
      amount: request.amount,
      approvalMethod: 'BATCH_CMS',
    });

    // 월별명세서에 추가
    await this.addToMonthlyStatement(account.id, transaction, 'REGULAR');

    return {
      success: true,
      paymentEventId: paymentEvent.id,
      transactionId: transaction.id,
      approvalMethod: 'BATCH_CMS' as const,
      message: 'BNPL 정규 결제가 승인되었습니다.',
    };
  }

  /**
   * 임시 결제 처리 (내부 신용도 기반)
   */
  private async processTemporaryPayment(
    account: any,
    request: { accountId: string; invoiceId: string; amount: number; description?: string; }
  ) {
    this.logger.log(`임시 결제 처리: ${request.accountId}`);

    // 내부 신용도 확인
    const canApprove = await this.canApproveWithInternalCredit(account.id, request.amount);
    if (!canApprove) {
      throw new Error('내부 신용도 한도를 초과했습니다. BatchCMS 등록 완료 후 이용 가능합니다.');
    }

    // PaymentEvent 생성
    const paymentEvent = await this.bnplPaymentService.requestPayment({
      invoiceId: request.invoiceId,
      paymentMethodId: account.paymentMethodId,
      amount: request.amount,
      actor: 'USER',
    });

    // BnplTransaction 생성 (임시)
    const transaction = await this.bnplTransactionService.createTransaction({
      bnplAccountId: account.id,
      invoiceId: request.invoiceId,
      transactionType: 'DEBIT',
      status: 'AUTHORIZED',
      amount: request.amount,
      approvalMethod: 'INTERNAL_CREDIT',
    });

    // 월별명세서에 추가 (임시)
    await this.addToMonthlyStatement(account.id, transaction, 'TEMPORARY');

    // 내부 신용도 사용량 업데이트
    await this.creditService.addTemporaryApprovalUsage(account.id, request.amount);

    return {
      success: true,
      paymentEventId: paymentEvent.id,
      transactionId: transaction.id,
      approvalMethod: 'INTERNAL_CREDIT' as const,
      message: 'BNPL 임시 결제가 승인되었습니다.',
    };
  }

  /**
   * 내부 신용도 기반 승인 가능 여부 확인
   */
  async canApproveWithInternalCredit(accountId: string, amount: number): Promise<boolean> {
    try {
      const creditInfo = await this.creditService.getAvailableCredit(accountId);
      return creditInfo.availableCredit >= amount;
    } catch (error) {
      this.logger.error(`내부 신용도 확인 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 월별명세서에 거래 추가
   */
  async addToMonthlyStatement(
    accountId: string, 
    transaction: any, 
    type: 'REGULAR' | 'TEMPORARY'
  ): Promise<void> {
    try {
      await this.monthlyStatementService.addTransaction(accountId, {
        ...transaction,
        approvalType: type,
      });
      
      this.logger.log(`월별명세서 추가 완료: ${accountId}, 타입: ${type}`);
    } catch (error) {
      this.logger.error(`월별명세서 추가 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * BNPL 결제 실패 처리
   *
   * 플로우:
   * 1. payment_event 테이블에 FAILED 이벤트 생성
   * 2. payment 테이블의 상태 업데이트
   */
  async failPayment(paymentId: string, reason: string) {
    this.logger.log(`BNPL 결제 실패 처리 시작: ${paymentId}, 사유: ${reason}`);

    try {
      // 결제 실패 처리 및 이벤트 생성
      const bnplPayment = await this.bnplPaymentService.failPayment({
        id: paymentId,
        errorMessage: reason,
        actor: 'USER',
      });

      this.logger.log(`BNPL 결제 실패 처리 완료: paymentId=${paymentId}`);

      return {
        success: true,
        eventId: bnplPayment.id,
        message: 'BNPL 결제 실패가 처리되었습니다.',
      };
    } catch (error) {
      this.logger.error(`BNPL 결제 실패 처리 오류: ${error.message}`);
      throw error;
    }
  }

  /**
   * BNPL 결제 캡처 처리
   *
   * 플로우:
   * 1. payment_event 테이블에 CAPTURED 이벤트 생성
   * 2. payment 테이블의 상태 업데이트
   * 3. bnpl_transaction 테이블에 이벤트 기록 (Event Sourcing)
   */
  async capturePayment(dto: paymentZod.Event.Capture) {
    this.logger.log(`BNPL 결제 캡처 시작: ${dto.id}`);

    try {
      // 결제 캡처 처리 및 이벤트 생성
      const result = await this.bnplPaymentService.capturePayment(dto);

      this.logger.log(`BNPL 결제 캡처 완료: paymentId=${dto.id}`);

      return {
        success: true,
        eventId: result.id,
        message: 'BNPL 결제가 성공적으로 처리되었습니다.',
      };
    } catch (error) {
      this.logger.error(`BNPL 결제 캡처 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * BNPL 계정 ID로부터 PaymentMethod ID 조회
   * 이벤트 기반 결제 처리에서 사용됩니다.
   */
  private async getPaymentMethodIdByAccount(bnplAccountId: string): Promise<string> {
    const account = await this.accountService.getAccountById(bnplAccountId);
    if (!account) {
      throw new Error(`BNPL 계정을 찾을 수 없습니다: ${bnplAccountId}`);
    }
    return account.paymentMethodId;
  }
}
