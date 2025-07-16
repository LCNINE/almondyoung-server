import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { eq } from 'drizzle-orm';
import {
  CreatePaymentMethodDto,
} from './dto/create-payment-method.dto';
import { ActivateBNPLDto } from './dto/activate-bnpl.dto';
import { DeactivateBNPLDto } from './dto/deactivate-bnpl.dto';
import { BNPLAccountResponseDto } from './dto/bnpl-account.response.dto';
import * as schema from './schema';
import { BnplService } from './services/bnpl.service';
import { CardPaymentProfileService, CardPaymentTransactionService } from './services/card-payment.service';
import { BatchCmsMemberService, BatchCmsAgreementService, BatchCmsWithdrawalService } from './services/batch-cms.service';

type PaymentMethod = typeof schema.paymentMethod.$inferSelect;
export type PaymentMethodWithDetails = PaymentMethod & {
  card: typeof schema.cardMethod.$inferSelect | null;
  bankAccount: typeof schema.bankAccountMethod.$inferSelect | null;
  rewardPoint: typeof schema.rewardPointMethod.$inferSelect | null;
};

/**
 * Payment method service handling CRUD operations and strategy coordination
 */
@Injectable()
export class PaymentMethodService {
  private strategyRegistry = new Map<string, any>(); // 임시로 전략 레지스트리 추가

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly bnplService: BnplService,
    // 카드 결제 서비스들 (실제 HMS API)
    private readonly cardPaymentProfileService: CardPaymentProfileService,
    private readonly cardPaymentTransactionService: CardPaymentTransactionService,
    // 배치 CMS 서비스들 (목업서버)
    private readonly batchCmsMemberService: BatchCmsMemberService,
    private readonly batchCmsAgreementService: BatchCmsAgreementService,
    private readonly batchCmsWithdrawalService: BatchCmsWithdrawalService,
  ) {
    // 전략 레지스트리 초기화 (필요시 실제 전략들을 등록)
    this.initializeStrategies();
  }

  private initializeStrategies() {
    // TODO: 실제 전략 구현체들을 등록
    // this.strategyRegistry.set('CARD', new CardPaymentStrategy());
    // this.strategyRegistry.set('BANK_ACCOUNT', new BankAccountStrategy());
    console.log('Payment strategies initialized');
  }

  /**
   * 카드 결제수단 생성 (실제 HMS API 연동)
   * BNPL(배치 CMS)은 별도 엔드포인트 사용: POST /payment-methods/batch-cms
   */
  async createPaymentMethod(dto: CreatePaymentMethodDto): Promise<unknown> {
    // BNPL은 별도 엔드포인트로 분리됨
    if (dto.methodType === 'BNPL') {
      throw new BadRequestException(
        'BNPL(배치 CMS) 계좌는 POST /payment-methods/batch-cms 엔드포인트를 사용해주세요.',
      );
    }

    const strategy = this.strategyRegistry.get(dto.methodType);

    if (!strategy) {
      throw new BadRequestException(
        `지원하지 않는 결제수단입니다: ${dto.methodType}. 현재 지원: CARD`,
      );
    }

    return this.dbService.db.transaction(async (tx) => {
      return strategy.register(dto, tx);
    });
  }

  /**
   * ID로 결제 수단을 조회합니다.
   *
   * @param id - 결제 수단 ID
   * @returns
   */
  async findById(id: string): Promise<PaymentMethodWithDetails | null> {
    const result = await this.dbService.db.query.paymentMethod.findFirst({
      where: eq(schema.paymentMethod.id, id),
      with: {
        card: true,
        bankAccount: true,
        rewardPoint: true,
      },
    });

    return result as PaymentMethodWithDetails | null;
  }

  /**
   * 사용자의 모든 결제 수단을 조회합니다.
   * @param userId - 사용자 ID
   * @returns
   */
  async findByUserId(userId: number): Promise<PaymentMethodWithDetails[]> {
    const results = await this.dbService.db.query.paymentMethod.findMany({
      where: eq(schema.paymentMethod.userId, userId),
      with: {
        card: true,
        bankAccount: true,
        rewardPoint: true,
      },
    });
    return results as PaymentMethodWithDetails[];
  }

  /**
   * 결제 수단 정보를 업데이트합니다.
   * @param id - 결제 수단 ID
   * @param updates - 업데이트할 정보
   * @returns
   */
  async update(
    id: string,
    updates: Partial<{ methodName: string; isDefault: boolean }>,
  ): Promise<PaymentMethod | null> {
    const [updated] = await this.dbService.db
      .update(schema.paymentMethod)
      .set(updates)
      .where(eq(schema.paymentMethod.id, id))
      .returning();

    return updated || null;
  }

  /**
   * 결제 수단을 삭제합니다. (Soft delete)
   * @param id
   * @returns
   */
  async delete(id: string): Promise<PaymentMethod | null> {
    const [deleted] = await this.dbService.db
      .update(schema.paymentMethod)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(eq(schema.paymentMethod.id, id))
      .returning();

    return deleted || null;
  }

  // ────────────────────────────────────────────
  // BNPL 관련 메서드들
  // ────────────────────────────────────────────

  /**
   * 사용자의 BNPL 계정 정보를 조회합니다.
   * @param userId - 사용자 ID
   * @returns BNPL 계정 정보
   */
  async getBNPLAccount(userId: number): Promise<BNPLAccountResponseDto | null> {
    return this.bnplService.getBatchCmsAccount(userId);
  }

  /**
   * BNPL 활성화된 결제수단 목록을 조회합니다.
   * @param userId - 사용자 ID
   * @returns BNPL 활성화된 결제수단 목록
   */
  async getBNPLPaymentMethods(
    userId: number,
  ): Promise<PaymentMethodWithDetails[]> {
    return this.bnplService.getBatchCmsPaymentMethods(userId);
  }

  // ────────────────────────────────────────────
  // HMS API 사용 예시 메서드들
  // ────────────────────────────────────────────

  /**
   * 카드 결제 프로필 생성 (실제 HMS API 사용)
   * @param profileData - 결제 프로필 데이터
   */
  async createCardPaymentProfile(profileData: any) {
    try {
      console.log('🔥 카드 결제 프로필 생성 - 실제 HMS API 사용');
      const result = await this.cardPaymentProfileService.create(profileData);
      return result;
    } catch (error) {
      console.error('카드 결제 프로필 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 카드 결제 실행 (실제 HMS API 사용)
   * @param transactionData - 거래 데이터
   */
  async executeCardPayment(transactionData: any) {
    try {
      console.log('🔥 카드 결제 실행 - 실제 HMS API 사용');
      const result = await this.cardPaymentTransactionService.approve(transactionData);
      return result;
    } catch (error) {
      console.error('카드 결제 실행 실패:', error);
      throw error;
    }
  }

  /**
   * 배치 CMS 회원 생성 (목업서버 사용)
   * @param memberData - 회원 데이터
   */
  async createBatchCmsMember(memberData: any) {
    try {
      console.log('🔧 배치 CMS 회원 생성 - 목업서버 사용');
      const result = await this.batchCmsMemberService.create(memberData);
      return result;
    } catch (error) {
      console.error('배치 CMS 회원 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 배치 CMS 동의서 등록 (목업서버 사용)
   * @param custId - 고객 ID
   * @param memberId - 회원 ID
   * @param fileInput - 파일 입력
   */
  async registerBatchCmsAgreement(custId: string, memberId: string, fileInput: any) {
    try {
      console.log('🔧 배치 CMS 동의서 등록 - 목업서버 사용');
      const result = await this.batchCmsAgreementService.register(custId, memberId, fileInput);
      return result;
    } catch (error) {
      console.error('배치 CMS 동의서 등록 실패:', error);
      throw error;
    }
  }

  /**
   * 배치 CMS 출금 요청 (목업서버 사용)
   * @param paymentData - 출금 데이터
   */
  async requestBatchCmsWithdrawal(paymentData: any) {
    try {
      console.log('🔧 배치 CMS 출금 요청 - 목업서버 사용');
      const result = await this.batchCmsWithdrawalService.request(paymentData);
      return result;
    } catch (error) {
      console.error('배치 CMS 출금 요청 실패:', error);
      throw error;
    }
  }

  /**
   * HMS API 설정 정보 조회
   */
  getHmsApiConfig() {
    return {
      cardPayment: 'Real HMS API',
      batchCms: 'Mock Server',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  /**
   * 목업서버 상태 확인 (배치 CMS 목업 사용시에만)
   */
  async checkMockServerHealth() {
    try {
      const result = await this.batchCmsWithdrawalService.healthCheck();
      console.log('✅ 목업서버 상태 확인 성공:', result);
      return result;
    } catch (error) {
      console.error('❌ 목업서버 상태 확인 실패:', error);
      throw error;
    }
  }
}
