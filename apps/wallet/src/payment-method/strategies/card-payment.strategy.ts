import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { HmsAPI } from 'hms-api-wrapper';
import { PaymentProfileResponse } from 'hms-api-wrapper/dist/services/PaymentProfile/types';
import { eq, and } from 'drizzle-orm';
import { PaymentMethodStrategy } from './payment.strategy';
import * as schema from '../schema';
import { CreateCardPaymentMethodDto } from '../dto/create-payment-method.dto';

/**
 * Interface for deleted card information
 */
interface DeletedCardInfo {
  id: string;
  methodName: string;
  deletedAt: Date | null;
}

/**
 * Interface for HMS API payload
 */
interface HmsApiPayload {
  memberId: string;
  memberName: string;
  phone: string;
  paymentKind: 'CARD';
  validMonth: string;
  validYear: string;
  cardNumber: string;
  cardPassword: string;
  identityNumber: string;
  customerEmail: string;
  paymentNumber: string;
  payerName: string;
  payerNumber: string;
}

/**
 * Interface for HMS member response
 */
interface HmsMemberResponse {
  memberId: string;
  paymentCompany: string;
  paymentNumber: string;
}

/**
 * Interface for registration response
 */
interface RegisterResponse {
  id: string;
  hmsResponse: PaymentProfileResponse;
}

/**
 * Card payment strategy implementation for HMS API integration
 */
@Injectable()
export class CardPaymentStrategy implements PaymentMethodStrategy {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly hmsApi: HmsAPI,
  ) {}

  /**
   * Check if this strategy supports the given method type
   */
  supports(methodType: string): boolean {
    return methodType === 'CARD';
  }

  /**
   * Format phone number by removing hyphens
   */
  private formatPhoneNumber(phone: string): string {
    return phone.replace(/-/g, '');
  }

  /**
   * Format card number by removing hyphens
   */
  private formatCardNumber(cardNumber: string): string {
    return cardNumber.replace(/-/g, '');
  }

  /**
   * Format payer number from identity number (first 6 digits)
   */
  private formatPayerNumber(identityNumber: string): string {
    return identityNumber.replace(/-/g, '').substring(0, 6);
  }

  /**
   * Format expiry date to YYYYMM format
   */

  /**
   * Validate payment method registration payload
   */
  validate(payload: unknown): void {
    const dto = payload as CreateCardPaymentMethodDto;
    if (!dto.userId) {
      throw new BadRequestException('userId is required');
    }
    if (!dto.cardNumber) {
      throw new BadRequestException('cardNumber is required');
    }
    if (!dto.memberName) {
      throw new BadRequestException('memberName is required');
    }
  }

  /**
   * Find existing deleted card with same card number
   */
  private async findExistingDeletedCard(
    userId: number,
    cardNumber: string,
  ): Promise<DeletedCardInfo[]> {
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

  /**
   * Build HMS API payload from DTO
   */
  private buildHmsApiPayload(dto: CreateCardPaymentMethodDto): HmsApiPayload {
    const formattedCardNumber = this.formatCardNumber(dto.cardNumber);

    return {
      memberId: dto.userId.toString(), // HMS API requires string type
      memberName: dto.memberName,
      phone: this.formatPhoneNumber(dto.phone),
      paymentKind: 'CARD' as const,
      validMonth: dto.validMonth,
      validYear: dto.validYear,
      cardNumber: formattedCardNumber,
      cardPassword: dto.cardPassword,
      identityNumber: dto.identityNumber,
      customerEmail: dto.customerEmail,
      paymentNumber: formattedCardNumber,
      payerName: dto.payerName,
      payerNumber: this.formatPayerNumber(dto.identityNumber),
    };
  }

  /**
   * Call HMS API to register payment profile
   */
  private async callHmsApi(
    payload: HmsApiPayload,
  ): Promise<PaymentProfileResponse> {
    try {
      const response = await this.hmsApi.paymentProfiles.create(payload);

      if (response.member?.result?.flag !== 'Y') {
        throw new BadRequestException(
          `HMS API registration failed: ${response.member?.result?.message || 'Unknown error'}`,
        );
      }

      return response;
    } catch (error) {
      throw new BadRequestException(
        `Failed to register payment profile: ${error}`,
      );
    }
  }

  /**
   * Reactivate existing deleted card
   */
  private async reactivateDeletedCard(
    tx: Parameters<Parameters<typeof this.dbService.db.transaction>[0]>[0],
    paymentMethodId: string,
    member: HmsMemberResponse,
    dto: CreateCardPaymentMethodDto,
  ): Promise<void> {
    await tx
      .update(schema.paymentMethod)
      .set({
        methodName: `${member.paymentCompany} (${member.paymentNumber})`,
        isDefault: dto.isDefault ? true : false,
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

  /**
   * Create new card payment method
   */
  private async createNewCard(
    tx: Parameters<Parameters<typeof this.dbService.db.transaction>[0]>[0],
    member: HmsMemberResponse,
    dto: CreateCardPaymentMethodDto,
  ): Promise<string> {
    const [newPaymentMethod] = await tx
      .insert(schema.paymentMethod)
      .values({
        userId: dto.userId,
        methodType: 'CARD',
        methodName: `${member.paymentCompany} (${member.paymentNumber})`,
        isDefault: dto.isDefault ? true : false,
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

  /**
   * Register new card payment method
   */
  async register(payload: unknown): Promise<RegisterResponse> {
    const dto = payload as CreateCardPaymentMethodDto;
    this.validate(dto);

    const formattedCardNumber = this.formatCardNumber(dto.cardNumber);
    const existingDeletedCard = await this.findExistingDeletedCard(
      dto.userId,
      formattedCardNumber,
    );

    const hmsPayload = this.buildHmsApiPayload(dto);
    const pgResponse = await this.callHmsApi(hmsPayload);
    const member = pgResponse.member as HmsMemberResponse;

    if (!member) {
      throw new BadRequestException(
        'Invalid HMS API response: missing member data',
      );
    }

    let id = ''; // Initialize with empty string

    await this.dbService.db.transaction(async (tx) => {
      if (existingDeletedCard.length > 0) {
        id = existingDeletedCard[0].id;
        console.log(`Reactivating deleted card: ${id}`);
        await this.reactivateDeletedCard(tx, id, member, dto);
      } else {
        id = await this.createNewCard(tx, member, dto);
        console.log(`Created new card: ${id}`);
      }
    });

    if (!id) {
      throw new Error('Failed to create or reactivate payment method');
    }

    return {
      id,
      hmsResponse: pgResponse,
    };
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
   * Delete payment profile from HMS API
   */
  private async deleteFromHmsApi(pgToken: string): Promise<void> {
    try {
      await this.hmsApi.paymentProfiles.delete(pgToken);
    } catch (error) {
      console.error(`Failed to delete payment profile from HMS: ${error}`);
      // Continue with DB deletion even if HMS API fails
    }
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

  /**
   * Delete card payment method
   * Note: PaymentMethod validation is handled by Service layer
   */
  async delete(paymentMethodId: string): Promise<void> {
    const cardMethod = await this.findCardMethod(paymentMethodId);

    await this.deleteFromHmsApi(cardMethod.pgToken);
    await this.performLogicalDeletion(paymentMethodId);
  }
}
