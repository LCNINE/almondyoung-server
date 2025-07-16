import { Injectable, Logger } from '@nestjs/common';
import { BnplAccountService } from './services/bnpl-account.service';
import { HmsBnplService } from './services/hms-bnpl.service';
import { BnplSettlementService } from './services/bnpl-settlement.service';
import { BnplCreditService } from './services/bnpl-credit.service';
import { BnplPaymentService } from './services/bnpl-payment.service';
import { CreateBnplAccountDto } from './dto/create-bnpl-account.dto';
import { DeactivateBnplAccountDto } from './dto/deactivate-bnpl-account.dto';
import { BnplAccountResponse } from './dto/bnpl-account.dto';
import { SubmitAgreementDto } from './dto/submit-agreement.dto';
import { PaymentRequestDto, PaymentCaptureDto } from './dto/payment-request.dto';

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
    private readonly paymentService: BnplPaymentService,
  ) {
    this.logger.log('🚀 BNPL 서비스 초기화 완료');
  }

  /**
   * BNPL 계좌 등록 - 복잡한 프로세스 조율
   * 
   * 플로우:
   * 1. 신용 한도 평가
   * 2. HMS 배치 CMS에 회원 등록
   * 3. DB에 BNPL 계정 생성
   * 4. 초기 정산 배치 생성
   */
  async createBnplAccount(dto: CreateBnplAccountDto) {
    this.logger.log(`BNPL 계좌 등록 시작. userId: ${dto.userId}`);

    try {
      // 1. 신용 한도 평가 (dto에 creditLimit이 없는 경우)
      if (!dto.creditLimit) {
        dto.creditLimit = await this.creditService.evaluateInitialCreditLimit(dto.userId);
        this.logger.log(`신용 한도 평가 완료: ${dto.creditLimit}원`);
      }

      // 2. HMS 배치 CMS에 회원 등록
      const hmsResult = await this.hmsBnplService.registerMember(dto);
      this.logger.log(`HMS 회원 등록 완료: ${hmsResult.member.memberId}`);

      // 3. DB에 BNPL 계정 생성
      const accountResult = await this.accountService.createAccount(dto, hmsResult);

      // 4. 현재 달의 정산 배치 생성 (선택적)
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      try {
        await this.settlementService.createSettlementBatchForAccount(
          accountResult.bnplAccount,
          currentMonth
        );
        this.logger.log(`초기 정산 배치 생성 완료: ${currentMonth}`);
      } catch (error) {
        // 정산 배치 생성 실패는 계정 생성을 막지 않음
        this.logger.warn(`초기 정산 배치 생성 실패: ${error.message}`);
      }

      return {
        success: true,
        account: accountResult,
        hmsResult,
        message: 'BNPL 계좌가 성공적으로 등록되었습니다.',
      };
    } catch (error) {
      this.logger.error(`BNPL 계좌 등록 실패: ${error.message}`);

      // 롤백 처리가 필요한 경우
      // TODO: HMS 회원 등록이 성공했지만 DB 저장이 실패한 경우 HMS 회원 삭제

      throw error;
    }
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
  async deactivateBnplAccount(dto: DeactivateBnplAccountDto & { accountId: string }) {
    this.logger.log(`BNPL 계좌 비활성화 시작. accountId: ${dto.accountId}`);

    try {
      // 1. 계정 정보 조회 및 검증 (accountId로 직접 조회하는 메서드 필요)
      const account = await this.accountService.getAccountById(dto.accountId);
      if (!account) {
        throw new Error('BNPL 계정을 찾을 수 없습니다.');
      }

      // 2. 미정산 정산 배치 확인
      const statistics = await this.settlementService.getSettlementStatistics(account.id);
      if (statistics.totalPending > 0) {
        throw new Error(`미정산 금액이 ${statistics.totalPending}원 있어 비활성화할 수 없습니다.`);
      }

      // 3. HMS 배치 CMS에서 회원 삭제
      await this.hmsBnplService.deleteMember(`bnpl_${account.userId}`);

      // 4. DB에서 BNPL 계정 비활성화
      const result = await this.accountService.deactivateAccount(dto);

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

  async getBnplAccount(userId: number): Promise<BnplAccountResponse | null> {
    const account = await this.accountService.getAccountByUserId(userId);

    if (!account) {
      return null;
    }

    // 추가 정보 조합
    const creditInfo = await this.creditService.getAvailableCredit(account.id);
    const statistics = await this.settlementService.getSettlementStatistics(account.id);

    // ✅ 확장된 DTO의 모양에 정확히 맞춰서 객체를 만들어 반환
    const responseDto: BnplAccountResponse = {
      // 1. BnplAccountSchema에서 온 필드들
      id: account.id,
      userId: account.userId,
      paymentMethodId: account.paymentMethodId,
      creditLimit: account.creditLimit,
      approvedLimit: account.approvedLimit,
      currentBalance: account.currentBalance,
      status: account.status,
      billingCycleDay: account.billingCycleDay,
      termsUrl: account.termsUrl,
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
  async getBnplAccounts(userId: number) {
    return this.accountService.getAllAccountsByUserId(userId);
  }

  /**
   * BNPL 이벤트 히스토리 조회
   */
  async getBnplEventHistory(userId: number) {
    return this.accountService.getEventHistory(userId);
  }

  /**
   * BNPL 출금 요청 - 테스트용
   */
  async requestWithdrawal(withdrawalData: any) {
    this.logger.log(`BNPL 출금 요청 시작: ${withdrawalData.memberId}, 금액: ${withdrawalData.callAmount || withdrawalData.amount}원`);
    
    try {
      // 1. HMS 배치 CMS에 출금 요청
      const result = await this.hmsBnplService.requestWithdrawal(withdrawalData);
      
      // 2. 성공 시 payment_event 테이블에 기록
      if (result.payment && result.payment.status === '신청') {
        // BNPL 계정 조회
        const bnplAccount = await this.accountService.getAccountByUserId(
          parseInt(withdrawalData.memberId.split('_')[1], 10)
        );
        
        if (bnplAccount) {
          // payment 테이블에 기록
          const paymentResult = await this.paymentService.requestPayment({
            bnplAccountId: bnplAccount.id,
            invoiceId: parseInt(result.payment.transactionId.replace(/\D/g, ''), 10) || 999999,
            amount: result.payment.callAmount || withdrawalData.amount,
            description: `BNPL 출금 - ${result.payment.transactionId}`,
            metadata: { withdrawalData, hmsResponse: result }
          });
          
          this.logger.log(`BNPL 출금 요청 payment_event 기록 완료: ${paymentResult.paymentId}`);
          
          // 바로 캡처 처리
          await this.paymentService.capturePayment({
            paymentId: paymentResult.paymentId
          });
          
          this.logger.log(`BNPL 출금 캡처 처리 완료: ${paymentResult.paymentId}`);
          
          // 결과에 payment 정보 추가
          return {
            ...result,
            paymentId: paymentResult.paymentId,
            message: 'BNPL 출금 요청 및 이벤트 기록이 완료되었습니다.'
          };
        }
      }
      
      return result;
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
  async submitAgreement(dto: SubmitAgreementDto) {
    this.logger.log(`BNPL 동의자료 제출 시작. memberId: ${dto.memberId}`);

    try {
      // 동의자료를 파일 형태로 변환 (목업 서버에서는 텍스트로 처리)
      const fileInput = {
        content: dto.agreementText,
        filename: `agreement_${dto.memberId}_${Date.now()}.txt`,
        contentType: 'text/plain',
      };

      // HMS 배치 CMS에 동의자료 제출
      const result = await this.hmsBnplService.submitAgreement(
        dto.custId || 'default-cust',
        dto.memberId,
        fileInput
      );

      this.logger.log(`BNPL 동의자료 제출 완료: ${result.agreementFile?.agreementKey}`);

      return {
        success: true,
        agreementKey: result.agreementFile?.agreementKey,
        message: '동의자료가 성공적으로 제출되었습니다.',
      };
    } catch (error) {
      this.logger.error(`BNPL 동의자료 제출 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 대시보드용 통계 정보 (추가 기능)
   */
  async getDashboardStatistics(userId: number) {
    const account = await this.accountService.getAccountByUserId(userId);
    if (!account) {
      return null;
    }

    // 여러 서비스에서 정보 조합
    const [creditInfo, riskAssessment, settlementStats, accountStats] = await Promise.all([
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
        totalDebits: monthTransactions
          .filter((tx: any) => tx.transactionType === 'DEBIT')
          .reduce((sum: number, tx: any) => sum + tx.amount, 0),
        totalCredits: monthTransactions
          .filter((tx: any) => tx.transactionType === 'CREDIT')
          .reduce((sum: number, tx: any) => sum + tx.amount, 0),
        transactionCount: monthTransactions.length,
      },
    };
  }

  /**
   * BNPL 결제 요청 처리
   * 
   * 플로우:
   * 1. payment_event 테이블에 REQUESTED 이벤트 생성
   * 2. bnpl_transaction 테이블에 거래 기록
   */
  async requestPayment(dto: PaymentRequestDto) {
    this.logger.log(`BNPL 결제 요청 시작: ${dto.bnplAccountId}, 금액: ${dto.amount}원`);
    
    try {
      // 결제 요청 처리 및 이벤트 생성
      const result = await this.paymentService.requestPayment(dto);
      
      this.logger.log(`BNPL 결제 요청 완료: paymentId=${result.paymentId}`);
      
      return {
        success: true,
        paymentId: result.paymentId,
        transactionId: result.transactionId,
        message: 'BNPL 결제가 요청되었습니다.',
      };
    } catch (error) {
      this.logger.error(`BNPL 결제 요청 실패: ${error.message}`);
      
      // 결제 실패 처리
      if (error.paymentId) {
        await this.failPayment(error.paymentId, error.message);
      }
      
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
      const result = await this.paymentService.failPayment(paymentId, reason);
      
      this.logger.log(`BNPL 결제 실패 처리 완료: paymentId=${paymentId}`);
      
      return {
        success: true,
        eventId: result.eventId,
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
   * 3. bnpl_account 테이블의 currentBalance 업데이트
   */
  async capturePayment(dto: PaymentCaptureDto) {
    this.logger.log(`BNPL 결제 캡처 시작: ${dto.paymentId}`);
    
    try {
      // 결제 캡처 처리 및 이벤트 생성
      const result = await this.paymentService.capturePayment(dto);
      
      this.logger.log(`BNPL 결제 캡처 완료: paymentId=${dto.paymentId}`);
      
      return {
        success: true,
        eventId: result.eventId,
        message: 'BNPL 결제가 성공적으로 처리되었습니다.',
      };
    } catch (error) {
      this.logger.error(`BNPL 결제 캡처 실패: ${error.message}`);
      throw error;
    }
  }
}