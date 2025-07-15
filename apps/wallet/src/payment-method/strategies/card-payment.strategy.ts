import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { HmsAPI } from 'hms-api-wrapper';
import { PaymentProfileResponse } from 'hms-api-wrapper/dist/services/PaymentProfile/types';
import { eq, and } from 'drizzle-orm';
import { PaymentMethodStrategy } from './payment.strategy';
import * as schema from '../schema';
import { CreateCardPaymentMethodDto } from '../dto/create-payment-method.dto';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { CreatePaymentProfileDto } from 'hms-api-wrapper/dist/services/PaymentProfile/types';

// 타입 선언 개선 (HmsApiPayload 제거, CreatePaymentProfileDto 사용)
interface HmsMemberResponse {
  memberId: string;
  paymentCompany: string;
  paymentNumber: string;
  result?: { flag: string; message?: string };
}

@Injectable()
export class CardPaymentStrategy implements PaymentMethodStrategy {
  private readonly logger = new Logger(CardPaymentStrategy.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly hmsApi: HmsAPI,
  ) {}

  supportedTypes(): string[] {
    return ['CARD'];
  }

  supports(methodType: string): boolean {
    return this.supportedTypes().includes(methodType);
  }

  private formatPhoneNumber(phone: string): string {
    return phone.replace(/-/g, '');
  }

  private formatCardNumber(cardNumber: string): string {
    return cardNumber.replace(/-/g, '');
  }

  private formatPayerNumber(identityNumber: string): string {
    return identityNumber.replace(/-/g, '').substring(0, 6);
  }

  /**
   * 강화된 유효성 검사
   */
  validate(payload: unknown): asserts payload is CreateCardPaymentMethodDto {
    const dto = payload as CreateCardPaymentMethodDto;
    if (!dto.userId) throw new BadRequestException('userId is required');
    if (!dto.cardNumber)
      throw new BadRequestException('cardNumber is required');
    if (!dto.methodName)
      throw new BadRequestException('methodName is required');
    // 카드 번호 유효성 검사 (Luhn 알고리즘 등 추가 가능)
    const cleanCardNumber = dto.cardNumber.replace(/\D/g, '');
    if (cleanCardNumber.length < 13 || cleanCardNumber.length > 19) {
      throw new BadRequestException('Invalid card number length');
    }
  }

  private async findExistingDeletedCard(
    userId: number,
    cardNumber: string,
  ): Promise<{ id: string; methodName: string; deletedAt: Date | null }[]> {
    const lastFourDigits = cardNumber.slice(-4);
    return await this.dbService.db
      .select({
        id: schema.paymentMethod.id,
        methodName: schema.paymentMethod.methodName,
        deletedAt: schema.paymentMethod.updatedAt,
      })
      .from(schema.paymentMethod)
      .innerJoin(
        schema.cardMethod,
        eq(schema.paymentMethod.id, schema.cardMethod.id),
      )
      .where(
        and(
          eq(schema.paymentMethod.userId, userId),
          eq(schema.paymentMethod.status, 'DELETED'),
          eq(schema.paymentMethod.methodType, 'CARD'),
          eq(schema.cardMethod.lastFourDigits, lastFourDigits),
        ),
      )
      .limit(1);
  }

  private buildHmsApiPayload(
    dto: CreateCardPaymentMethodDto,
  ): CreatePaymentProfileDto {
    const formattedCardNumber = this.formatCardNumber(dto.cardNumber);
    return {
      memberId: dto.userId.toString(),
      memberName: dto.payerName,
      phone: this.formatPhoneNumber(dto.phone),
      paymentKind: 'CARD',
      validMonth: dto.validMonth,
      validYear: dto.validYear,
      paymentNumber: formattedCardNumber,
      payerName: dto.payerName,
      payerNumber: this.formatPayerNumber(dto.identityNumber),
      password: dto.cardPassword,
      email: dto.customerEmail,
    };
  }

  /**
   * 보안 강화된 HMS API 호출
   */
  private async callHmsApi(payload: CreatePaymentProfileDto): Promise<any> {
    try {
      const response = await this.hmsApi.paymentProfiles.create(payload);
      if (response.member.result.flag !== 'Y') {
        const errorMsg = response.member.result.message || 'Unknown HMS error';
        this.logger.error(
          `HMS API failed: ${errorMsg}`,
          JSON.stringify(response),
        );
        throw new BadRequestException(
          `Payment registration failed: ${errorMsg}`,
        );
      }
      return response;
    } catch (error) {
      this.logger.error('HMS API call failed', error.stack);
      throw new InternalServerErrorException('Payment service unavailable');
    }
  }

  /**
   * 트랜잭션 인식 개선된 메서드
   */
  private async reactivateDeletedCard(
    tx: PostgresJsDatabase<typeof schema>,
    paymentMethodId: string,
    member: HmsMemberResponse,
    dto: CreateCardPaymentMethodDto,
  ): Promise<void> {
    await tx
      .update(schema.paymentMethod)
      .set({
        methodName: `${member.paymentCompany} (${member.paymentNumber})`,
        isDefault: !!dto.isDefault,
        status: 'ACTIVE',
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentMethod.id, paymentMethodId));
    await tx
      .update(schema.cardMethod)
      .set({
        pgToken: member.memberId,
        billingKey: member.memberId,
        maskedCardNumber: member.paymentNumber,
        lastFourDigits: this.formatCardNumber(dto.cardNumber).slice(-4),
        cardBrand: member.paymentCompany,
      })
      .where(eq(schema.cardMethod.id, paymentMethodId));
  }

  private async createNewCard(
    tx: PostgresJsDatabase<typeof schema>,
    member: HmsMemberResponse,
    dto: CreateCardPaymentMethodDto,
  ): Promise<string> {
    const [newPaymentMethod] = await tx
      .insert(schema.paymentMethod)
      .values({
        userId: dto.userId,
        methodType: 'CARD',
        methodName: `${member.paymentCompany} (${member.paymentNumber})`,
        isDefault: !!dto.isDefault,
        institutionCode: member.paymentCompany,
        status: 'ACTIVE',
      })
      .returning();
    await tx.insert(schema.cardMethod).values({
      id: newPaymentMethod.id,
      pgToken: member.memberId,
      billingKey: member.memberId,
      maskedCardNumber: member.paymentNumber,
      lastFourDigits: this.formatCardNumber(dto.cardNumber).slice(-4),
      cardBrand: member.paymentCompany,
    });
    return newPaymentMethod.id;
  }

  async register(
    payload: unknown,
    tx: PostgresJsDatabase<typeof schema>,
  ): Promise<{ id: string; hmsResponse: any }> {
    this.validate(payload);
    const dto = payload as CreateCardPaymentMethodDto;
    try {
      const existingDeletedCard = await this.findExistingDeletedCard(
        dto.userId,
        dto.cardNumber,
      );
      const hmsPayload = this.buildHmsApiPayload(dto);
      const pgResponse: any = await this.callHmsApi(hmsPayload);
      const member = (pgResponse as any).member as HmsMemberResponse;
      if (!member || !member.memberId) {
        throw new BadRequestException('Invalid HMS response structure');
      }
      let paymentMethodId: string;
      if (existingDeletedCard.length > 0) {
        paymentMethodId = existingDeletedCard[0].id;
        this.logger.log(`Reactivating card: ${paymentMethodId}`);
        await this.reactivateDeletedCard(tx, paymentMethodId, member, dto);
      } else {
        paymentMethodId = await this.createNewCard(tx, member, dto);
        this.logger.log(`Created new card: ${paymentMethodId}`);
      }
      return {
        id: paymentMethodId,
        hmsResponse: pgResponse,
      };
    } catch (error) {
      this.logger.error(
        `Card registration failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async delete(paymentMethodId: string): Promise<void> {
    try {
      const cardMethod = await this.findCardMethod(paymentMethodId);
      await this.deleteFromHmsApi(cardMethod.pgToken);
      await this.performLogicalDeletion(paymentMethodId);
    } catch (error) {
      this.logger.error(`Card deletion failed: ${error.message}`, error.stack);
      if (error instanceof HmsApiDeleteFailedException) {
        throw new BadRequestException(
          'Card deleted locally but failed in payment gateway. Please contact support.',
        );
      }
      throw error;
    }
  }

  private async deleteFromHmsApi(pgToken: string): Promise<void> {
    try {
      const response = await this.hmsApi.paymentProfiles.delete(pgToken);
      if (!response.member.result || response.member.result.flag !== 'Y') {
        throw new HmsApiDeleteFailedException(
          response.member.result?.message || 'HMS deletion failed',
        );
      }
    } catch (error) {
      throw new HmsApiDeleteFailedException(error.message);
    }
  }

  /**
   * Find card method by ID (Strategy-specific logic)
   */
  private async findCardMethod(
    paymentMethodId: string,
  ): Promise<{ pgToken: string }> {
    const cardMethod = await this.dbService.db
      .select({ pgToken: schema.cardMethod.pgToken })
      .from(schema.cardMethod)
      .where(eq(schema.cardMethod.id, paymentMethodId))
      .limit(1);

    if (!cardMethod.length) {
      throw new NotFoundException(
        `Card method with ID ${paymentMethodId} not found`,
      );
    }

    return cardMethod[0];
  }

  /**
   * Perform logical deletion in database
   */
  private async performLogicalDeletion(paymentMethodId: string): Promise<void> {
    await this.dbService.db
      .update(schema.paymentMethod)
      .set({ status: 'DELETED' })
      .where(eq(schema.paymentMethod.id, paymentMethodId));
  }
}

class HmsApiDeleteFailedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HmsApiDeleteFailedException';
  }
}
