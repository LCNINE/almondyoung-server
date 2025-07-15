import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { HmsAPI } from 'hms-api-wrapper';
import { eq, and } from 'drizzle-orm';
import * as schema from '../payment-method/schema';
import { CreateCardMethodDto } from './dto/create-card-method.dto';
import { IMethodService } from './types/card-method.interface';
import {
  formatPhoneNumber,
  formatCardNumber,
  formatPayerNumber,
  buildHmsApiPayload,
  HmsApiPayload,
} from './utils/card-method.util';

interface HmsMemberResponse {
  memberId: string;
  paymentCompany: string;
  paymentNumber: string;
}

@Injectable()
export class CardMethodService implements IMethodService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    @Inject(HmsAPI) private readonly hmsApi: HmsAPI,
  ) {}

  private async callHmsApi(payload: HmsApiPayload) {
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
  private async findExistingDeletedCard(userId: number, cardNumber: string) {
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
  private async reactivateDeletedCard(
    tx: Parameters<Parameters<typeof this.dbService.db.transaction>[0]>[0],
    paymentMethodId: string,
    member: HmsMemberResponse,
    dto: CreateCardMethodDto,
  ) {
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
        lastFourDigits: formatCardNumber(dto.cardNumber).slice(-4),
        cardBrand: member.paymentCompany,
      })
      .where(eq(schema.cardMethod.id, paymentMethodId));
  }
  private async createNewCard(
    tx: Parameters<Parameters<typeof this.dbService.db.transaction>[0]>[0],
    member: HmsMemberResponse,
    dto: CreateCardMethodDto,
  ) {
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
      lastFourDigits: formatCardNumber(dto.cardNumber).slice(-4),
      cardBrand: member.paymentCompany,
    });
    return newPaymentMethod.id;
  }

  async register(dto: CreateCardMethodDto) {
    this.validate(dto);
    const formattedCardNumber = formatCardNumber(dto.cardNumber);
    const existingDeletedCard = await this.findExistingDeletedCard(
      dto.userId,
      formattedCardNumber,
    );
    const hmsPayload = buildHmsApiPayload(dto);
    const pgResponse = await this.callHmsApi(hmsPayload);
    const member = pgResponse.member as HmsMemberResponse;
    if (!member) {
      throw new BadRequestException(
        'Invalid HMS API response: missing member data',
      );
    }
    let id = '';
    await this.dbService.db.transaction(async (tx) => {
      if (existingDeletedCard.length > 0) {
        id = existingDeletedCard[0].id;
        await this.reactivateDeletedCard(tx, id, member, dto);
      } else {
        id = await this.createNewCard(tx, member, dto);
      }
      // 기본카드 설정 시 기존 기본카드 해제
      if (dto.isDefault) {
        await tx
          .update(schema.paymentMethod)
          .set({ isDefault: false })
          .where(
            and(
              eq(schema.paymentMethod.userId, dto.userId),
              eq(schema.paymentMethod.methodType, 'CARD'),
            ),
          );
        await tx
          .update(schema.paymentMethod)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(schema.paymentMethod.id, id));
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

  validate(payload: unknown): void {
    const dto = payload as CreateCardMethodDto;
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

  async delete(id: string) {
    // 1. 카드 정보 조회
    const card = await this.dbService.db.query.paymentMethod.findFirst({
      where: eq(schema.paymentMethod.id, id),
      with: { card: true },
    });
    if (!card) throw new NotFoundException('카드 결제수단을 찾을 수 없습니다.');
    // 2. HMS API 해지(빌링키 해지)
    try {
      if (card.card?.pgToken) {
        await this.hmsApi.paymentProfiles.delete(card.card.pgToken);
      }
    } catch (e) {
      // HMS API 해지 실패 시에도 DB soft delete는 진행
    }
    // 3. DB에서 status = 'DELETED'로 soft delete
    await this.dbService.db
      .update(schema.paymentMethod)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(eq(schema.paymentMethod.id, id));
    return { success: true };
  }

  async getList(userId: number) {
    // 해당 userId의 ACTIVE 카드 목록 반환
    const results = await this.dbService.db.query.paymentMethod.findMany({
      where: and(
        eq(schema.paymentMethod.userId, userId),
        eq(schema.paymentMethod.methodType, 'CARD'),
        eq(schema.paymentMethod.status, 'ACTIVE'),
      ),
      with: {
        card: true,
      },
    });
    return results;
  }

  async setDefault(id: string) {
    // 1. 해당 카드 정보 조회
    const card = await this.dbService.db.query.paymentMethod.findFirst({
      where: eq(schema.paymentMethod.id, id),
    });
    if (!card) throw new NotFoundException('카드 결제수단을 찾을 수 없습니다.');
    // 2. 같은 userId의 모든 카드 isDefault = false
    await this.dbService.db
      .update(schema.paymentMethod)
      .set({ isDefault: false })
      .where(
        and(
          eq(schema.paymentMethod.userId, card.userId),
          eq(schema.paymentMethod.methodType, 'CARD'),
        ),
      );
    // 3. 해당 카드만 isDefault = true
    await this.dbService.db
      .update(schema.paymentMethod)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(schema.paymentMethod.id, id));
    return { success: true };
  }
}
