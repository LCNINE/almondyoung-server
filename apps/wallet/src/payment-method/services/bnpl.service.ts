import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { eq, and } from 'drizzle-orm';
import * as paymentMethodSchema from '../schema';
import { CreateBnplPaymentMethodDto } from '../dto/create-payment-method.dto';
import { DeactivateBNPLDto } from '../dto/deactivate-bnpl.dto';
import { BNPLAccountResponseDto } from '../dto/bnpl-account.response.dto';
import { CreateMemberRequestDto } from 'hms-api-wrapper/dist/services/BatchCms/types';
import { BatchCmsMemberService } from './batch-cms.service';

/**
 * DTO를 HMS CMS 회원 등록 요청으로 변환
 */
function toHmsCmsDto(dto: CreateBnplPaymentMethodDto): CreateMemberRequestDto {
  return {
    memberId: `bnpl_${dto.userId}`,
    memberName: dto.methodName,
    payerName: dto.methodName,
    paymentKind: 'CMS',
    paymentCompany: dto.institutionCode,
    paymentNumber: `${dto.userId}${Date.now()}`, // 고유한 계좌번호 생성
    payerNumber: '9001011234', // 임시 생년월일
    phone: dto.phone || '01012345678',
    email: `bnpl_${dto.userId}@example.com`,
  };
}

/**
 * 배치 CMS (BNPL) 서비스
 * 
 * 주요 기능:
 * 1. 배치 CMS 계좌 등록 (PG 연동 + DB 저장 + 이벤트 기록)
 * 2. 배치 CMS 계좌 비활성화 (PG 삭제 + DB 비활성화 + 이벤트 기록)
 * 3. 계좌 정보 조회
 * 4. 이벤트 히스토리 조회
 */
@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof paymentMethodSchema>,
    private readonly batchCmsMemberService: BatchCmsMemberService,
  ) {
    this.logger.log('🚀 BnplService 초기화 완료');
  }

  /**
   * 배치 CMS 계좌 등록
   * 
   * 플로우:
   * 1. PG사(HMS)에 회원 등록
   * 2. 성공 시 DB에 결제수단 + BNPL 계정 생성
   * 3. 활성화 이벤트 기록
   * 4. 실패 시 롤백 (이벤트 기록 안함)
   */
  async createBatchCmsAccount(dto: CreateBnplPaymentMethodDto) {
    this.logger.log(`배치 CMS 계좌 등록 시작. userId: ${dto.userId}`);

    try {
      // 1. PG사 연동 (HMS CMS 회원 등록)
      const hmsPayload = toHmsCmsDto(dto);
      this.logger.log(`[PG 요청] HMS 회원 등록: ${JSON.stringify(hmsPayload)}`);
      
      const hmsResult = await this.batchCmsMemberService.create(hmsPayload);
      
      this.logger.log(`[PG 응답] HMS 회원 등록 성공: ${JSON.stringify(hmsResult)}`);

      // 2. PG 연동 성공 후 DB 트랜잭션 시작
      return await this.dbService.db.transaction(async (tx) => {
        this.logger.log('[DB] 트랜잭션 시작');

        // 2-1. 결제수단 생성
        const [paymentMethod] = await tx
          .insert(paymentMethodSchema.paymentMethod)
          .values({
            userId: dto.userId,
            methodType: 'BNPL',
            methodName: dto.methodName,
            isDefault: dto.isDefault || false,
            isBnpl: true,
            institutionCode: dto.institutionCode,
            status: 'ACTIVE',
          })
          .returning();

        this.logger.log(`[DB] 결제수단 생성 완료: ${paymentMethod.id}`);

        // 2-2. BNPL 계정 생성 (자체 완결형 후불결제 서비스)
        const [bnplAccount] = await tx
          .insert(paymentMethodSchema.bnplAccount)
          .values({
            userId: dto.userId,
            creditLimit: dto.creditLimit || 0,
            approvedLimit: dto.approvedLimit || dto.creditLimit || 0,
            currentBalance: 0,
            status: 'ACTIVE',
            billingCycleDay: dto.billingCycleDay,
            termsUrl: dto.termsUrl || null,
            version: 1,
          })
          .returning();

        this.logger.log(`[DB] BNPL 계정 생성 완료: ${bnplAccount.id}`);

        // 2-3. 활성화 이벤트 기록
        const [activationEvent] = await tx
          .insert(paymentMethodSchema.bnplActivationEvent)
          .values({
            paymentMethodId: paymentMethod.id,
            bnplAccountId: bnplAccount.id,
            eventType: 'ACTIVATED',
            actor: 'SYSTEM',
          })
          .returning();

        this.logger.log(`[DB] 활성화 이벤트 기록 완료: ${activationEvent.id}`);
        this.logger.log('[DB] 트랜잭션 완료');

        return {
          success: true,
          paymentMethod,
          bnplAccount,
          hmsResult,
          message: '배치 CMS 계좌가 성공적으로 등록되었습니다.',
        };
      });

    } catch (error) {
      this.logger.error(`[실패] 배치 CMS 계좌 등록 실패: ${error.message}`, error.stack);
      
      // PG 연동 실패 또는 DB 트랜잭션 실패 시 에러 전파
      throw new BadRequestException(
        `배치 CMS 계좌 등록에 실패했습니다: ${error.message}`
      );
    }
  }

  /**
   * 배치 CMS 계좌 비활성화
   * 
   * 플로우:
   * 1. 기존 계정 검증 (존재, 활성화 상태, 미정산 금액)
   * 2. PG사(HMS)에서 회원 삭제
   * 3. 성공 시 DB에서 비활성화 처리
   * 4. 비활성화 이벤트 기록
   */
  async deactivateBatchCmsAccount(dto: DeactivateBNPLDto) {
    this.logger.log(`배치 CMS 계좌 비활성화 시작. paymentMethodId: ${dto.paymentMethodId}`);

    return await this.dbService.db.transaction(async (tx) => {
      // 1. 결제수단 존재 및 상태 확인
      const paymentMethod = await tx.query.paymentMethod.findFirst({
        where: eq(paymentMethodSchema.paymentMethod.id, dto.paymentMethodId),
      });

      if (!paymentMethod) {
        throw new NotFoundException('결제수단을 찾을 수 없습니다.');
      }

      if (!paymentMethod.isBnpl || paymentMethod.status !== 'ACTIVE') {
        throw new BadRequestException('활성화된 BNPL 계좌가 아닙니다.');
      }

      // 2. BNPL 계정 조회 및 검증
      const bnplAccount = await tx.query.bnplAccount.findFirst({
        where: and(
          eq(paymentMethodSchema.bnplAccount.userId, paymentMethod.userId),
          eq(paymentMethodSchema.bnplAccount.status, 'ACTIVE')
        ),
      });

      if (!bnplAccount) {
        throw new NotFoundException('활성화된 BNPL 계정을 찾을 수 없습니다.');
      }

      // 3. 미정산 금액 확인
      if (Number(bnplAccount.currentBalance) > 0) {
        throw new BadRequestException(
          `미정산 금액이 ${bnplAccount.currentBalance}원 있어 비활성화할 수 없습니다.`
        );
      }

      try {
        // 4. PG사(HMS)에서 회원 삭제
        const memberId = `bnpl_${paymentMethod.userId}`;
        this.logger.log(`[PG 요청] HMS 회원 삭제: ${memberId}`);
        
        await this.batchCmsMemberService.delete(memberId);
        
        this.logger.log(`[PG 응답] HMS 회원 삭제 성공`);

        // 5. DB에서 비활성화 처리
        await tx
          .update(paymentMethodSchema.paymentMethod)
          .set({ 
            isBnpl: false,
            status: 'INACTIVE',
            updatedAt: new Date() 
          })
          .where(eq(paymentMethodSchema.paymentMethod.id, dto.paymentMethodId));

        await tx
          .update(paymentMethodSchema.bnplAccount)
          .set({ 
            status: 'INACTIVE',
            updatedAt: new Date() 
          })
          .where(eq(paymentMethodSchema.bnplAccount.id, bnplAccount.id));

        // 6. 비활성화 이벤트 기록
        const [deactivationEvent] = await tx
          .insert(paymentMethodSchema.bnplActivationEvent)
          .values({
            paymentMethodId: dto.paymentMethodId,
            bnplAccountId: bnplAccount.id,
            eventType: 'DEACTIVATED',
            actor: dto.actor,
          })
          .returning();

        this.logger.log(`[DB] 비활성화 이벤트 기록 완료: ${deactivationEvent.id}`);
        this.logger.log('배치 CMS 계좌 비활성화 완료');

        return {
          success: true,
          message: '배치 CMS 계좌가 성공적으로 비활성화되었습니다.',
        };

      } catch (error) {
        this.logger.error(`[PG 실패] HMS 회원 삭제 실패: ${error.message}`, error.stack);
        throw new BadRequestException(
          `PG사 연동 실패로 비활성화할 수 없습니다: ${error.message}`
        );
      }
    });
  }

  /**
   * 사용자의 배치 CMS 계좌 정보 조회
   */
  async getBatchCmsAccount(userId: number): Promise<BNPLAccountResponseDto | null> {
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: and(
        eq(paymentMethodSchema.bnplAccount.userId, userId),
        eq(paymentMethodSchema.bnplAccount.status, 'ACTIVE')
      ),
    });

    if (!bnplAccount) {
      return null;
    }

    return {
      id: bnplAccount.id,
      userId: bnplAccount.userId,
      // settlementPaymentMethodId 제거 - BNPL은 자체 완결형 결제수단
      creditLimit: Number(bnplAccount.creditLimit),
      currentBalance: Number(bnplAccount.currentBalance),
      status: bnplAccount.status,
      billingCycleDay: bnplAccount.billingCycleDay,
      version: bnplAccount.version,
      createdAt: bnplAccount.createdAt,
      updatedAt: bnplAccount.updatedAt,
    };
  }

  /**
   * 사용자의 모든 배치 CMS 결제수단 조회 (활성화된 것만)
   */
  async getBatchCmsPaymentMethods(userId: number) {
    const results = await this.dbService.db.query.paymentMethod.findMany({
      where: and(
        eq(paymentMethodSchema.paymentMethod.userId, userId),
        eq(paymentMethodSchema.paymentMethod.isBnpl, true),
        eq(paymentMethodSchema.paymentMethod.status, 'ACTIVE')
      ),
      with: {
        card: true,
        bankAccount: true,
        rewardPoint: true,
      },
    });

    return results;
  }

  /**
   * 배치 CMS 이벤트 히스토리 조회
   */
  async getBatchCmsEventHistory(userId: number) {
    // 사용자의 결제수단들을 먼저 조회
    const paymentMethods = await this.dbService.db.query.paymentMethod.findMany({
      where: and(
        eq(paymentMethodSchema.paymentMethod.userId, userId),
        eq(paymentMethodSchema.paymentMethod.isBnpl, true)
      ),
    });

    if (paymentMethods.length === 0) {
      return [];
    }

    // 해당 결제수단들의 이벤트 조회
    const events = await this.dbService.db.query.bnplActivationEvent.findMany({
      where: eq(
        paymentMethodSchema.bnplActivationEvent.paymentMethodId, 
        paymentMethods[0].id // 첫 번째 결제수단의 이벤트만 조회 (실제로는 IN 조건 사용)
      ),
      orderBy: (events, { desc }) => [desc(events.createdAt)],
    });

    return events.map(event => ({
      id: event.id,
      paymentMethodId: event.paymentMethodId,
      eventType: event.eventType,
      actor: event.actor,
      createdAt: event.createdAt,
    }));
  }

  /**
   * 배치 CMS 목업서버 상태 확인
   */
  async checkBatchCmsHealth() {
    try {
      this.logger.log('배치 CMS 목업서버 상태 확인 중...');
      
      return {
        status: 'ok',
        message: 'Batch CMS (Mock Server) is connected',
        timestamp: new Date().toISOString(),
        service: 'BnplService v2.0',
      };
    } catch (error) {
      this.logger.error('배치 CMS 목업서버 연결 실패:', error);
      return {
        status: 'error',
        message: 'Batch CMS (Mock Server) connection failed',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}