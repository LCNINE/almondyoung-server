// services/bnpl.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { CreateBNPLMethodDto } from '../shared/dtos/bnpl/create-bnpl-method.dto';
import { WalletTx } from '../shared/database';
import {
  ConsentResponseDto,
  MemberStatusResponseDto,
  PaymentMethodResponseDto,
} from '../shared/dtos/bnpl/submit-consent.dto';
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper';
import { ApiClientFactory } from 'hms-api-wrapper';
import { ulid } from 'ulid';
import { getTsid } from 'tsid-ts';
import {
  BnplMemberNotFoundError,
  BnplMemberAlreadyExistsError,
  BnplAccountNotFoundError,
  HmsMemberCreationFailedError,
} from '../shared/errors/payment.errors';

// HMS API 타입 정의
export interface HmsMemberCreateResult {
  memberId: string;
  status: string;
  rawResponse: any;
}

export interface HmsAgreementResult {
  success: boolean;
  agreementId?: string;
  rawResponse: any;
}

export interface HmsMemberStatusResult {
  hmsStatus: string;
  registeredAt: Date | null;
  creditLimit: number;
  approvedLimit: number;
  rawResponse: any;
}

export interface HmsWithdrawalRequest {
  memberId: string;
  amount: number;
  paymentDate: string;
  invoiceId: string;
}

export interface HmsWithdrawalResult {
  success: boolean;
  transactionId: string;
  status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'CANCELLED';
  amount: number;
  error?: string;
  rawResponse: any;
}

export interface HmsRefundRequest {
  transactionId: string;
  amount: number;
  reason: string;
}

export interface HmsRefundResult {
  success: boolean;
  refundId: string;
  status: 'SUCCESS' | 'FAILED';
  message: string;
  rawResponse: any;
}

// 파일 업로드 타입 정의 (Fastify 호환)
export interface UploadedFileInfo {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class BNPLService {
  private readonly logger = new Logger(BNPLService.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor(private readonly db: DbService<typeof schema>) {
    // 🔍 디버깅: 환경변수 상태 출력
    this.logger.debug('=== 환경변수 디버깅 ===');
    this.logger.debug(`USE_MOCK: ${process.env.USE_MOCK}`);
    this.logger.debug(`SW_KEY: ${process.env.SW_KEY ? '✅ 존재' : '❌ 없음'}`);
    this.logger.debug(
      `CUST_KEY: ${process.env.CUST_KEY ? '✅ 존재' : '❌ 없음'}`,
    );
    this.logger.debug(`NODE_ENV: ${process.env.NODE_ENV || '(설정안됨)'}`);
    this.logger.debug('===================');

    // 환경 변수 검증
    if (process.env.USE_MOCK !== 'true') {
      if (!process.env.SW_KEY || !process.env.CUST_KEY) {
        throw new Error('실제 HMS API 사용 시 SW_KEY와 CUST_KEY가 필요합니다.');
      }
    }

    // ApiClientFactory를 사용하여 환경 변수에 따라 자동으로 목업/실제 API 선택
    this.hmsApi = ApiClientFactory.createFromEnv();

    const apiType = process.env.USE_MOCK === 'true' ? 'Mock' : 'Real HMS Test';
    this.logger.log(`BNPLService 초기화 완료 - ${apiType} 서버 사용`);

    if (process.env.USE_MOCK !== 'true') {
      this.logger.log(
        '⚠️  실제 HMS 테스트 서버 사용 중 - 회원 등록 및 출금 승인은 수기 처리 필요',
      );
    }
  }

  /** BNPL 회원 등록 */
  async registerMember(
    dto: CreateBNPLMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    this.logger.log(`BNPL 회원 등록 시작: ${dto.userId}`);

    return await this.db.db.transaction(async (tx) => {
      // 1. 비즈니스 검증
      await this.validateNewMember(dto.userId, tx);

      // 2. HMS API를 통한 회원 등록
      const hmsResult = await this.createHmsMember({
        memberName: dto.methodName,
        payerName: dto.methodName,
        phone: '01012345678', // TODO: 실제 사용자 정보에서 가져오기
      });

      if (!hmsResult.memberId) {
        throw new HmsMemberCreationFailedError(
          'HMS에서 회원 ID를 반환하지 않았습니다',
        );
      }

      // 3. 결제수단 테이블에 저장
      const paymentMethod = await this.savePaymentMethod(
        dto,
        hmsResult.memberId,
        tx,
      );

      // 4. BNPL 계정 테이블에 저장
      const bnplAccount = await this.saveBNPLAccount(dto, paymentMethod.id, tx);

      // 5. BatchCMS 전용 메타데이터 저장
      await this.saveBatchCmsMethod(paymentMethod.id, hmsResult, dto, tx);

      this.logger.log(`BNPL 회원 등록 완료: ${paymentMethod.id}`);

      return {
        paymentMethodId: paymentMethod.id,
        bnplAccountId: bnplAccount.id,
        hmsMemberId: hmsResult.memberId,
        status: paymentMethod.status,
        userId: paymentMethod.userId,
        methodName: paymentMethod.methodName,
        methodType: paymentMethod.methodType,
        message: '회원 등록이 완료되었습니다. 출금동의서를 제출해주세요.',
      };
    });
  }

  /** 출금동의서 제출 */
  async submitConsent(
    memberId: string,
    file: UploadedFileInfo,
  ): Promise<ConsentResponseDto> {
    this.logger.log(`출금동의서 제출: ${memberId}`);

    // 1. 회원 존재 확인
    await this.validateMemberExists(memberId);

    // 파일 검증은 Controller 계층에서 이미 완료됨

    // 3. HMS API 동의서 제출
    const result = await this.submitHmsAgreement({
      memberId,
      file: file.buffer,
      filename: file.filename,
    });

    // 4. 성공 시 결제수단 상태 활성화
    if (result.success) {
      await this.activatePaymentMethod(memberId);
      this.logger.log(`BNPL 계정 활성화 완료: ${memberId}`);
    }

    return {
      success: result.success,
      message: result.success
        ? '출금동의서가 성공적으로 제출되었습니다'
        : '동의서 제출에 실패했습니다',
      registrationComplete: result.success,
    };
  }

  /** 회원 상태 조회 */
  async getMemberStatus(memberId: string): Promise<MemberStatusResponseDto> {
    const result = await this.getHmsMemberStatus(memberId);

    // BNPL 계정에서 실제 한도 정보 조회
    const [bnplAccount] = await this.db.db
      .select()
      .from(schema.bnplAccount)
      .where(eq(schema.bnplAccount.paymentMethodId, memberId))
      .limit(1);

    return {
      status: this.mapHmsStatusToInternal(result.hmsStatus),
      registeredAt: bnplAccount?.createdAt?.toISOString(),
      creditLimit: bnplAccount?.creditLimit || 0,
      approvedLimit: bnplAccount?.approvedLimit || 0,
    };
  }

  /** BNPL 계정 정보 조회 */
  async getBNPLAccount(
    userId: string,
  ): Promise<typeof schema.bnplAccount.$inferSelect> {
    const [account] = await this.db.db
      .select()
      .from(schema.bnplAccount)
      .where(eq(schema.bnplAccount.userId, userId))
      .limit(1);

    if (!account) {
      throw new BnplAccountNotFoundError(userId);
    }

    return account; // Drizzle 타입 추론 활용
  }

  // === HMS API 관련 메서드들 ===

  /** HMS 회원 생성 */
  async createHmsMember(memberInfo: {
    memberName: string;
    payerName: string;
    phone: string;
  }): Promise<HmsMemberCreateResult> {
    this.logger.log(`HMS 회원 생성: ${memberInfo.memberName}`);

    const response = await this.hmsApi.members.create({
      memberId: getTsid().toString(),
      memberName: memberInfo.memberName,
      payerName: memberInfo.payerName,
      paymentKind: 'CMS',
      paymentCompany: 'BATCHCMS',
      paymentNumber: ulid(),
      payerNumber: ulid(),
      phone: memberInfo.phone,
    });

    return {
      memberId: response.member.memberId,
      status: response.member.status,
      rawResponse: response,
    };
  }

  /** HMS 동의서 제출 */
  async submitHmsAgreement(request: {
    memberId: string;
    file: Buffer;
    filename: string;
  }): Promise<HmsAgreementResult> {
    this.logger.log(`HMS 동의서 제출: ${request.memberId}`);

    const result = await this.hmsApi.agreements.register(
      'default-cust',
      request.memberId,
      {
        file: request.file,
        filename: request.filename,
      },
    );

    return {
      success: true,
      agreementId: 'agreement-' + Date.now(),
      rawResponse: result,
    };
  }

  /** HMS 회원 상태 조회 */
  async getHmsMemberStatus(memberId: string): Promise<HmsMemberStatusResult> {
    this.logger.log(`HMS 회원 상태 조회: ${memberId}`);

    const result = await this.hmsApi.members.get(memberId);

    return {
      hmsStatus: result.member.status || 'UNKNOWN',
      registeredAt: null, // HMS API 응답에서 등록일시는 별도 관리
      creditLimit: 0, // HMS에서 제공하지 않으므로 내부에서 관리
      approvedLimit: 0, // HMS에서 제공하지 않으므로 내부에서 관리
      rawResponse: result,
    };
  }

  /** HMS 출금 요청 */
  async requestWithdrawal(
    request: HmsWithdrawalRequest,
  ): Promise<HmsWithdrawalResult> {
    this.logger.log(
      `HMS 출금 요청: ${request.memberId}, 금액=${request.amount}`,
    );

    try {
      const result = await this.hmsApi.withdrawals.request({
        memberId: request.memberId,
        callAmount: request.amount,
        paymentDate: request.paymentDate,
        transactionId: getTsid().toString(),
      });

      // HMS 상태를 표준 상태로 매핑
      const status = this.mapWithdrawalStatus(result.payment.status);

      return {
        success: true,
        transactionId: result.payment.transactionId,
        status,
        amount: result.payment.callAmount,
        rawResponse: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS 출금 요청 실패: ${errorMessage}`);
      return {
        success: false,
        transactionId: '',
        status: 'FAILED',
        amount: request.amount,
        error: errorMessage,
        rawResponse: {},
      };
    }
  }

  /** HMS 출금 상태 조회 */
  async getWithdrawalStatus(
    transactionId: string,
  ): Promise<HmsWithdrawalResult> {
    this.logger.log(`HMS 출금 상태 조회: ${transactionId}`);

    try {
      const result = await this.hmsApi.withdrawals.get(transactionId);
      const status = this.mapWithdrawalStatus(result.payment.status);

      return {
        success: true,
        transactionId: result.payment.transactionId,
        status,
        amount: result.payment.callAmount,
        rawResponse: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS 출금 상태 조회 실패: ${errorMessage}`);
      return {
        success: false,
        transactionId,
        status: 'FAILED',
        amount: 0,
        error: errorMessage,
        rawResponse: {},
      };
    }
  }

  /** HMS 환불 요청 */
  requestRefund(request: HmsRefundRequest): HmsRefundResult {
    this.logger.log(
      `HMS 환불 요청: ${request.transactionId}, 금액=${request.amount}`,
    );

    // NOTE: HMS API에 환불 기능이 있다면 구현, 없다면 기록만
    return {
      success: true,
      refundId: `REFUND-${Date.now()}`,
      status: 'SUCCESS',
      message: '환불 요청이 기록되었습니다',
      rawResponse: {},
    };
  }

  // === Private 헬퍼 메서드들 ===

  private async validateNewMember(userId: string, tx: WalletTx): Promise<void> {
    // 이미 BNPL 계정이 있는지 확인
    const existing = await tx
      .select()
      .from(schema.bnplAccount)
      .where(eq(schema.bnplAccount.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      throw new BnplMemberAlreadyExistsError(userId);
    }
  }

  private async validateMemberExists(memberId: string): Promise<void> {
    const [method] = await this.db.db
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.id, memberId))
      .limit(1);

    if (!method || method.methodType !== 'BNPL') {
      throw new BnplMemberNotFoundError(memberId);
    }
  }

  // 파일 검증은 Controller 계층에서 처리하므로 제거됨

  private async savePaymentMethod(
    dto: CreateBNPLMethodDto,
    hmsMemberId: string,
    tx: WalletTx,
  ): Promise<typeof schema.paymentMethod.$inferSelect> {
    const insertData: typeof schema.paymentMethod.$inferInsert = {
      id: hmsMemberId, // HMS 회원 ID를 결제수단 ID로 사용
      userId: dto.userId,
      methodType: 'BNPL',
      methodName: dto.methodName,
      status: 'PENDING',
    };

    const [method] = await tx
      .insert(schema.paymentMethod)
      .values(insertData)
      .returning();

    return method;
  }

  private async saveBNPLAccount(
    dto: CreateBNPLMethodDto,
    paymentMethodId: string,
    tx: WalletTx,
  ): Promise<typeof schema.bnplAccount.$inferSelect> {
    const insertData: typeof schema.bnplAccount.$inferInsert = {
      userId: dto.userId,
      paymentMethodId,
      creditLimit: dto.creditLimit,
      approvedLimit: dto.creditLimit, // 초기에는 동일
      billingCycleDay: dto.billingCycleDay,
      termsUrl: dto.termsUrl,
    };

    const [account] = await tx
      .insert(schema.bnplAccount)
      .values(insertData)
      .returning();

    return account;
  }

  private async saveBatchCmsMethod(
    paymentMethodId: string,
    hmsResult: HmsMemberCreateResult,
    dto: CreateBNPLMethodDto,
    tx: WalletTx,
  ): Promise<void> {
    const insertData: typeof schema.batchCmsMethod.$inferInsert = {
      id: paymentMethodId,
      paymentMethodId,
      hmsMemberId: hmsResult.memberId,
      hmsCustId: 'default-cust',
      creditLimit: dto.creditLimit,
      approvedLimit: dto.creditLimit,
      billingCycleDay: dto.billingCycleDay,
      termsUrl: dto.termsUrl,
    };

    await tx.insert(schema.batchCmsMethod).values(insertData);
  }

  private async activatePaymentMethod(memberId: string): Promise<void> {
    await this.db.db
      .update(schema.paymentMethod)
      .set({
        status: 'ACTIVE',
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentMethod.id, memberId));
  }

  private mapHmsStatusToInternal(
    hmsStatus: string,
  ): 'PENDING' | 'REGISTERED' | 'FAILED' {
    switch (hmsStatus) {
      case '신청완료':
        return 'REGISTERED';
      case '신청대기':
        return 'PENDING';
      default:
        return 'FAILED';
    }
  }

  private mapWithdrawalStatus(
    hmsStatus: string,
  ): 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'CANCELLED' {
    if (['출금대기', '출금중', '출금성공'].includes(hmsStatus)) {
      return 'AUTHORIZED';
    }
    if (['처리완료', '출금성공'].includes(hmsStatus)) {
      return 'CAPTURED';
    }
    if (['출금실패', '실패'].includes(hmsStatus)) {
      return 'FAILED';
    }
    if (hmsStatus === '취소') {
      return 'CANCELLED';
    }
    return 'FAILED';
  }

  /**
   * HMS API를 통한 회원 상태 조회 (스케줄러용)
   */
  async checkMemberStatus(
    userId: string,
    bnplAccountId: string,
  ): Promise<{
    status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
    reason?: string;
    approvedAt?: string;
    rejectedAt?: string;
    metadata?: Record<string, any>;
  }> {
    this.logger.log(
      `🔍 HMS 회원 상태 조회: userId=${userId}, accountId=${bnplAccountId}`,
    );

    try {
      // Mock HMS API 호출 (실제로는 HMS API 엔드포인트 호출)
      // 현재는 즉시 승인 처리되도록 Mock 설정
      await new Promise((resolve) => setTimeout(resolve, 100)); // Mock delay
      const mockResponse = {
        status: 'APPROVED' as const, // Mock에서는 즉시 승인 처리
        approvedAt: new Date().toISOString(),
        metadata: {
          checkDate: new Date().toISOString(),
          source: 'HMS_API',
          mockData: true,
        },
      };

      this.logger.log(
        `📊 HMS 상태 조회 결과: ${mockResponse.status} (accountId: ${bnplAccountId})`,
      );

      return mockResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`💥 HMS 회원 상태 조회 실패: ${errorMessage}`);
      throw new Error(`HMS API 호출 실패: ${errorMessage}`);
    }
  }

  /**
   * BNPL 계정 이벤트 기록 (스케줄러용)
   */
  async recordAccountEvent(
    paymentMethodId: string,
    bnplAccountId: string,
    eventType: 'ACCOUNT_ACTIVATED' | 'ACCOUNT_REJECTED' | 'STATUS_CHECKED',
    eventData: Record<string, any>,
    transaction?: WalletTx,
  ): Promise<void> {
    const tx = transaction || this.db.db;

    try {
      // BNPL 전용 활성화 이벤트 테이블 사용
      if (
        eventType === 'ACCOUNT_ACTIVATED' ||
        eventType === 'ACCOUNT_REJECTED'
      ) {
        await tx.insert(schema.bnplActivationEvent).values({
          paymentMethodId: paymentMethodId, // 결제수단 ID
          bnplAccountId: bnplAccountId, // BNPL 계정 ID (실제 bnpl_account.id)
          eventType:
            eventType === 'ACCOUNT_ACTIVATED' ? 'ACTIVATED' : 'DEACTIVATED',
          actor: 'SCHEDULER',
        });

        this.logger.log(
          `📝 BNPL 활성화 이벤트 기록 완료: ${eventType} (accountId: ${bnplAccountId})`,
        );
      } else {
        // 기타 상태 체크 이벤트는 단순 로그만
        this.logger.log(
          `📊 BNPL 상태 체크: ${eventType} (accountId: ${bnplAccountId})`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`💥 BNPL 이벤트 기록 실패: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * BNPL 계정 조회 (헬퍼 메서드)
   */
  async getBnplAccount(bnplAccountId: string) {
    const [account] = await this.db.db
      .select()
      .from(schema.bnplAccount)
      .where(eq(schema.bnplAccount.id, bnplAccountId))
      .limit(1);

    return account || null;
  }
}
