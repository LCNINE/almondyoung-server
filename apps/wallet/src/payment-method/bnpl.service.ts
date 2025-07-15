import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from './schema';
import { CreateBnplPaymentMethodDto } from './dto/create-payment-method.dto';
import { ActivateBNPLDto } from './dto/activate-bnpl.dto';
import { DeactivateBNPLDto } from './dto/deactivate-bnpl.dto';
import { BNPLAccountResponseDto } from './dto/bnpl-account.response.dto';
import { HmsAPI } from 'hms-api-wrapper';
import { CreatePaymentProfileDto } from 'hms-api-wrapper/dist/services/PaymentProfile/types';
import { eq, and } from 'drizzle-orm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateMemberRequestDto } from 'hms-api-wrapper/dist/services/BatchCms/types';

function toHmsCmsDto(dto: CreateBnplPaymentMethodDto): CreateMemberRequestDto {
  return {
    memberId: dto.userId.toString(),
    memberName: dto.methodName,
    phone: dto.phone ?? '01012345678',
    paymentKind: 'CMS',
    paymentCompany: dto.institutionCode ?? '088',
    paymentNumber: dto.settlementPaymentMethodId ?? '1234567890123456',
    payerName: dto.methodName,
    payerNumber: '900101',
    // 기타 BNPL용 필수 필드만 전달
  };
}

@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    @Inject('BATCH_CMS_MOCK_HMS_API') private readonly mockHmsApi: HmsAPI,
  ) {}

  async create(dto: CreateBnplPaymentMethodDto) {
    try {
      const hmsPayload = toHmsCmsDto(dto);
      // BNPL/CMS용 API(batchCms.members.create)를 호출하도록 수정 (any 캐스팅으로 임시 해결)
      const hmsResult = await (this.mockHmsApi as any).batchCms.members.create(
        hmsPayload,
      );
      this.logger.log(`Mock HMS API 호출 성공: ${JSON.stringify(hmsResult)}`);
      return this.dbService.db.transaction(async (tx) => {
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
            settlementPaymentMethodId: dto.settlementPaymentMethodId,
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

        return { paymentMethod, bnplAccount };
      });
    } catch (error) {
      this.logger.error(
        `Mock HMS API 호출 실패: ${error.message}`,
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
          settlementPaymentMethodId: dto.settlementPaymentMethodId,
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
        settlementPaymentMethodId: bnplAccount.settlementPaymentMethodId,
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
      // 5. 결제수단에서 BNPL 비활성화
      await tx
        .update(schema.paymentMethod)
        .set({ isBnpl: false, updatedAt: new Date() })
        .where(eq(schema.paymentMethod.id, dto.paymentMethodId));
      // 6. BNPL 비활성화 이벤트 기록
      await tx.insert(schema.bnplActivationEvent).values({
        paymentMethodId: dto.paymentMethodId,
        bnplAccountId: bnplAccount.id,
        eventType: 'DEACTIVATED',
        actor: dto.actor,
      });
      return { success: true };
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
      settlementPaymentMethodId: bnplAccount.settlementPaymentMethodId,
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
        prepaidWallet: true,
        rewardPoint: true,
      },
    });
    return results;
  }

  // 추후 activateBNPL, deactivateBNPL 등 BNPL 관련 메서드 추가 예정
}
