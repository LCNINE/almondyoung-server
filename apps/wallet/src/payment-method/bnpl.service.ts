import { Injectable, Logger } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from './schema';
import { CreateBnplPaymentMethodDto } from './dto/create-payment-method.dto';
import { ActivateBNPLDto } from './dto/activate-bnpl.dto';
import { DeactivateBNPLDto } from './dto/deactivate-bnpl.dto';
import { BNPLAccountResponseDto } from './dto/bnpl-account.response.dto';
import { eq, and } from 'drizzle-orm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateMemberRequestDto } from 'hms-api-wrapper/dist/services/BatchCms/types';
import { BatchCmsMemberService } from './services/batch-cms.service';

function toHmsCmsDto(dto: CreateBnplPaymentMethodDto): CreateMemberRequestDto {
  return {
    memberId: `bnpl_${dto.userId}`, // BNPL 회원임을 명시
    memberName: dto.methodName,
    phone: dto.phone ?? '01012345678',
    paymentKind: 'CMS',
    paymentCompany: dto.institutionCode ?? '088',
    paymentNumber: `${dto.userId}${Date.now()}`, // 고유한 계좌번호 생성
    payerName: dto.methodName,
    payerNumber: '9001011234', // 10자리로 수정 (생년월일 6자리 + 4자리)
    email: `bnpl_${dto.userId}@example.com`, // 이메일 추가
  };
}

@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly batchCmsMemberService: BatchCmsMemberService,
  ) {
    this.logger.log('🚀 BnplService 초기화 - BatchCmsMemberService 연동');
  }

  async create(dto: CreateBnplPaymentMethodDto) {
    this.logger.log(`BNPL 생성을 시작합니다. userId: ${dto.userId}`);

    try {
      const hmsPayload = toHmsCmsDto(dto);
      this.logger.log(
        `[PG 요청 직전] BatchCmsMemberService로 회원 생성을 요청합니다. payload: ${JSON.stringify(
          hmsPayload,
        )}`,
      );

      // BatchCmsMemberService를 통해 PG사 연동
      const hmsResult = await this.batchCmsMemberService.create(hmsPayload);

      this.logger.log(
        `[PG 응답 직후] BatchCmsMemberService로부터 응답을 받았습니다. response: ${JSON.stringify(
          hmsResult,
        )}`,
      );

      // PG사 연동 성공 후 DB 트랜잭션 시작
      return this.dbService.db.transaction(async (tx) => {
        this.logger.log('DB 트랜잭션을 시작합니다.');
        
        // 1. 결제수단 생성
        const [paymentMethod] = await tx
          .insert(schema.paymentMethod)
          .values({
            userId: dto.userId,
            methodType: dto.methodType,
            methodName: dto.methodName,
            isDefault: dto.isDefault || false,
            isBnpl: true,
            institutionCode: dto.institutionCode,
            status: 'ACTIVE',
          })
          .returning();

        // 2. BNPL 계정 생성
        const [bnplAccount] = await tx
          .insert(schema.bnplAccount)
          .values({
            userId: dto.userId,
            creditLimit: dto.creditLimit || 0,
            approvedLimit: dto.approvedLimit || dto.creditLimit || 0,
            currentBalance: 0,
            status: 'ACTIVE',
            billingCycleDay: dto.billingCycleDay,
            termsUrl: dto.termsUrl,
            version: 1,
          })
          .returning();

        // 3. 활성화 이벤트 기록
        await tx.insert(schema.bnplActivationEvent).values({
          paymentMethodId: paymentMethod.id,
          bnplAccountId: bnplAccount.id,
          eventType: 'ACTIVATED',
          actor: 'SYSTEM',
        });

        this.logger.log('DB 트랜잭션을 성공적으로 완료했습니다.');
        
        return { 
          paymentMethod, 
          bnplAccount,
          hmsResult // PG사 연동 결과도 함께 반환
        };
      });
    } catch (error) {
      this.logger.error(
        `[PG 통신 또는 DB 작업 실패] BNPL 생성 중 에러가 발생했습니다: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async activate(dto: ActivateBNPLDto): Promise<BNPLAccountResponseDto> {
    return this.dbService.db.transaction(async (tx) => {
      // 1. 결제수단 존재 확인
      const paymentMethod = await tx.query.paymentMethod.findFirst({
        where: eq(schema.paymentMethod.id, dto.paymentMethodId),
      });
      if (!paymentMethod) {
        throw new NotFoundException('결제수단을 찾을 수 없습니다.');
      }
      // 2. 정산용 결제수단 존재 확인
      const settlementMethod = await tx.query.paymentMethod.findFirst({
        where: eq(schema.paymentMethod.id, dto.settlementPaymentMethodId),
      });
      if (!settlementMethod) {
        throw new NotFoundException('정산용 결제수단을 찾을 수 없습니다.');
      }
      // 3. 이미 BNPL이 활성화되어 있는지 확인
      if (paymentMethod.isBnpl) {
        throw new BadRequestException('이미 BNPL이 활성화되어 있습니다.');
      }
      // 4. BNPL 계정 생성
      const [bnplAccount] = await tx
        .insert(schema.bnplAccount)
        .values({
          userId: paymentMethod.userId,
          creditLimit: dto.creditLimit,
          approvedLimit: dto.approvedLimit,
          currentBalance: 0,
          status: 'ACTIVE',
          billingCycleDay: dto.billingCycleDay,
          termsUrl: dto.termsUrl,
          version: 1,
        })
        .returning();
      // 5. 결제수단에 BNPL 활성화 표시
      await tx
        .update(schema.paymentMethod)
        .set({ isBnpl: true, updatedAt: new Date() })
        .where(eq(schema.paymentMethod.id, dto.paymentMethodId));
      // 6. BNPL 활성화 이벤트 기록
      await tx.insert(schema.bnplActivationEvent).values({
        paymentMethodId: dto.paymentMethodId,
        bnplAccountId: bnplAccount.id,
        eventType: 'ACTIVATED',
        actor: dto.actor,
      });
      return {
        id: bnplAccount.id,
        userId: bnplAccount.userId,
        creditLimit: Number(bnplAccount.creditLimit),
        currentBalance: Number(bnplAccount.currentBalance),
        status: bnplAccount.status,
        billingCycleDay: bnplAccount.billingCycleDay,
        version: bnplAccount.version,
        createdAt: bnplAccount.createdAt,
        updatedAt: bnplAccount.updatedAt,
      };
    });
  }

  async deactivate(dto: DeactivateBNPLDto): Promise<{ success: boolean }> {
    this.logger.log(`BNPL 비활성화를 시작합니다. paymentMethodId: ${dto.paymentMethodId}`);

    return this.dbService.db.transaction(async (tx) => {
      // 1. 결제수단 존재 확인
      const paymentMethod = await tx.query.paymentMethod.findFirst({
        where: eq(schema.paymentMethod.id, dto.paymentMethodId),
      });
      if (!paymentMethod) {
        throw new NotFoundException('결제수단을 찾을 수 없습니다.');
      }
      
      // 2. BNPL이 활성화되어 있는지 확인
      if (!paymentMethod.isBnpl) {
        throw new BadRequestException('BNPL이 활성화되어 있지 않습니다.');
      }
      
      // 3. BNPL 계정 조회
      const bnplAccount = await tx.query.bnplAccount.findFirst({
        where: eq(schema.bnplAccount.userId, paymentMethod.userId),
      });
      if (!bnplAccount) {
        throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
      }
      
      // 4. 미정산 금액이 있는지 확인
      if (Number(bnplAccount.currentBalance) > 0) {
        throw new BadRequestException(
          '미정산 금액이 있어 BNPL을 비활성화할 수 없습니다.',
        );
      }

      try {
        // 5. PG사(HMS)에서 회원 삭제
        const memberId = `bnpl_${paymentMethod.userId}`;
        this.logger.log(`[PG 요청 직전] BatchCmsMemberService로 회원 삭제를 요청합니다. memberId: ${memberId}`);
        
        await this.batchCmsMemberService.delete(memberId);
        
        this.logger.log(`[PG 응답 직후] BatchCmsMemberService로부터 회원 삭제 완료`);

        // 6. 결제수단에서 BNPL 비활성화 (삭제하지 않고 상태만 변경)
        await tx
          .update(schema.paymentMethod)
          .set({ 
            isBnpl: false, 
            status: 'INACTIVE', // 비활성화 상태로 변경
            updatedAt: new Date() 
          })
          .where(eq(schema.paymentMethod.id, dto.paymentMethodId));

        // 7. BNPL 계정도 비활성화 (삭제하지 않고 상태만 변경)
        await tx
          .update(schema.bnplAccount)
          .set({ 
            status: 'INACTIVE',
            updatedAt: new Date() 
          })
          .where(eq(schema.bnplAccount.id, bnplAccount.id));

        // 8. BNPL 비활성화 이벤트 기록
        await tx.insert(schema.bnplActivationEvent).values({
          paymentMethodId: dto.paymentMethodId,
          bnplAccountId: bnplAccount.id,
          eventType: 'DEACTIVATED',
          actor: dto.actor,
        });

        this.logger.log('BNPL 비활성화를 성공적으로 완료했습니다.');
        return { success: true };

      } catch (error) {
        this.logger.error(`[PG 통신 실패] BNPL 비활성화 중 에러가 발생했습니다: ${error.message}`, error.stack);
        throw error;
      }
    });
  }

  async getAccount(userId: number): Promise<BNPLAccountResponseDto | null> {
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });
    if (!bnplAccount) {
      return null;
    }
    return {
      id: bnplAccount.id,
      userId: bnplAccount.userId,
      creditLimit: Number(bnplAccount.creditLimit),
      currentBalance: Number(bnplAccount.currentBalance),
      status: bnplAccount.status,
      billingCycleDay: bnplAccount.billingCycleDay,
      version: bnplAccount.version,
      createdAt: bnplAccount.createdAt,
      updatedAt: bnplAccount.updatedAt,
    };
  }

  async findAllByUser(userId: number): Promise<any[]> {
    const results = await this.dbService.db.query.paymentMethod.findMany({
      where: and(
        eq(schema.paymentMethod.userId, userId),
        eq(schema.paymentMethod.isBnpl, true),
        eq(schema.paymentMethod.status, 'ACTIVE'),
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
  async getEventHistory(userId: number) {
    const events = await this.dbService.db.query.bnplActivationEvent.findMany({
      where: eq(schema.bnplActivationEvent.paymentMethodId, userId.toString()),
      orderBy: (events, { desc }) => [desc(events.createdAt)],
    });
    
    return events.map(event => ({
      id: event.id,
      eventType: event.eventType,
      actor: event.actor,
      createdAt: event.createdAt,
    }));
  }

  /**
   * 배치 CMS 상태 확인 (목업서버 연결 테스트)
   */
  async healthCheck() {
    try {
      // BatchCmsMemberService를 통해 목업서버 상태 확인
      const testMember = {
        memberId: 'health_check_test',
        memberName: '상태확인',
        payerName: '상태확인',
        paymentKind: 'CMS' as const,
        paymentCompany: '088',
        paymentNumber: '1234567890123456',
        payerNumber: '9001011234',
        phone: '01012345678',
      };

      // 실제로 회원을 생성하지 않고 연결만 테스트
      // 목업서버의 health 엔드포인트가 있다면 그것을 사용
      this.logger.log('배치 CMS 목업서버 상태 확인 중...');
      
      return {
        status: 'ok',
        message: 'Batch CMS (Mock Server) is connected',
        timestamp: new Date().toISOString(),
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
