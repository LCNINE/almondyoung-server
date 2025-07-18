import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from '../../shared/schemas/schema';
import { ulid } from 'ulid';
import { CreatePaymentMethodPayload } from '../../shared/zod';
import { eq } from 'drizzle-orm';

/**
 * 결제수단(PaymentMethod) 도메인 서비스
 *
 * 역할
 * 1. 결제수단 생성 (초기 status=PENDING)
 * 2. 결제수단 정보 수정 (methodName, isDefault 등)
 * 3. 결제수단 비활성화/삭제 (소프트)
 */
@Injectable()
export class PaymentMethodService {
  private readonly logger = new Logger(PaymentMethodService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 결제수단 신규 등록
   * - status 는 항상 PENDING 으로 시작
   * - isDefault=true 요청 시, 같은 userId 의 다른 isDefault 를 false 로 설정
   */
  async create(dto: CreatePaymentMethodPayload) {
    return await this.dbService.db.transaction(async (tx) => {
      if (dto.isDefault) {
        // 동일 사용자 기존 기본 결제수단 해제
        await tx
          .update(schema.paymentMethod)
          .set({ isDefault: false })
          .where(eq(schema.paymentMethod.userId, dto.userId));
      }

      const [paymentMethod] = await tx
        .insert(schema.paymentMethod)
        .values({
          id: ulid(),
          userId: dto.userId,
          methodType: dto.methodType,
          methodName: dto.methodName,
          isDefault: dto.isDefault ?? false,
          institutionCode: dto.institutionCode,
          status: 'PENDING',
        })
        .returning();

      this.logger.log(`PaymentMethod created: ${paymentMethod.id}`);
      return paymentMethod;
    });
  }

  /**
   * 결제수단 정보 수정
   */
  async update(
    id: string,
    updates: Partial<Omit<CreatePaymentMethodPayload, 'userId' | 'methodType'>>,
  ) {
    if (!updates || Object.keys(updates).length === 0) {
      throw new BadRequestException('업데이트할 필드를 제공하세요.');
    }

    return await this.dbService.db.transaction(async (tx) => {
      const existing = await tx.query.paymentMethod.findFirst({
        where: eq(schema.paymentMethod.id, id),
      });

      if (!existing) {
        throw new NotFoundException('PaymentMethod not found');
      }

      // isDefault=true 로 바꾸려면 기존 기본값 해제
      if (updates.isDefault) {
        await tx
          .update(schema.paymentMethod)
          .set({ isDefault: false })
          .where(eq(schema.paymentMethod.userId, existing.userId));
      }

      const [updated] = await tx
        .update(schema.paymentMethod)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(schema.paymentMethod.id, id))
        .returning();

      this.logger.log(`PaymentMethod updated: ${updated.id}`);
      return updated;
    });
  }

  /**
   * 결제수단 비활성화 (Soft Delete)
   */
  async deactivate(id: string) {
    const [updated] = await this.dbService.db
      .update(schema.paymentMethod)
      .set({ status: 'INACTIVE', updatedAt: new Date() })
      .where(eq(schema.paymentMethod.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException('PaymentMethod not found');
    }

    this.logger.log(`PaymentMethod deactivated: ${updated.id}`);
    return updated;
  }

  /**
   * 은행 인증 결과 콜백: status ACTIVE | FAILED 로 변경
   */
  async verifyStatus(id: string, status: 'ACTIVE' | 'FAILED') {
    if (!['ACTIVE', 'FAILED'].includes(status)) {
      throw new BadRequestException('status must be ACTIVE or FAILED');
    }

    const [updated] = await this.dbService.db
      .update(schema.paymentMethod)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.paymentMethod.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException('PaymentMethod not found');
    }

    this.logger.log(`PaymentMethod verified (${status}): ${updated.id}`);
    return updated;
  }
}
