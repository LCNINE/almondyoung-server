// services/bnpl.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { CreateBNPLMethodDto } from '../shared/dtos/bnpl/create-bnpl-method.dto';
import {
  BatchCmsService,
  type HmsMemberCreateResult,
} from './batch-cms.service';
import { WalletTx } from '../shared/database';
import {
  ConsentResponseDto,
  MemberStatusResponseDto,
  PaymentMethodResponseDto,
} from '../shared/dtos/bnpl/submit-consent.dto';

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

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly batchCmsService: BatchCmsService,
  ) {}

  /** BNPL 회원 등록 */
  async registerMember(
    dto: CreateBNPLMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    this.logger.log(`BNPL 회원 등록 시작: ${dto.userId}`);

    return await this.db.db.transaction(async (tx) => {
      // 1. 비즈니스 검증
      await this.validateNewMember(dto.userId, tx);

      // 2. HMS API를 통한 회원 등록
      const hmsResult = await this.batchCmsService.createMember({
        memberName: dto.methodName,
        payerName: dto.methodName,
        phone: '01012345678', // TODO: 실제 사용자 정보에서 가져오기
      });

      if (!hmsResult.memberId) {
        throw new BadRequestException('HMS 회원 등록에 실패했습니다');
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

    // 2. 파일 검증
    this.validateConsentFile(file);

    // 3. HMS API 동의서 제출
    const result = await this.batchCmsService.submitAgreement({
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
    const result = await this.batchCmsService.getMemberStatus(memberId);

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
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다');
    }

    return account; // Drizzle 타입 추론 활용
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
      throw new BadRequestException('이미 BNPL 계정이 존재합니다');
    }
  }

  private async validateMemberExists(memberId: string): Promise<void> {
    const [method] = await this.db.db
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.id, memberId))
      .limit(1);

    if (!method || method.methodType !== 'BNPL') {
      throw new NotFoundException('BNPL 회원을 찾을 수 없습니다');
    }
  }

  private validateConsentFile(file: UploadedFileInfo): void {
    if (!file) {
      throw new BadRequestException('출금동의서 파일이 필요합니다');
    }

    // 파일 타입 검증
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('PDF 또는 이미지 파일만 업로드 가능합니다');
    }

    // 파일 크기 검증 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('파일 크기는 5MB 이하여야 합니다');
    }
  }

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
}
