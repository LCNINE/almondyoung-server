import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from './schema';
import { HmsCardService } from './services/hms-card.service';
import { CreateCardMethodDto } from './dto/create-card-method';
import { CardMethodResponseDto } from './dto/card-method-response.dto';
import { plainToClass } from 'class-transformer';
import { ulid } from 'ulid';

@Injectable()
export class PgIntegrationService {
  private readonly logger = new Logger(PgIntegrationService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private hmsCardService: HmsCardService,
  ) {}

  /**
   * 카드 결제수단 등록
   */
  async registerCard(dto: CreateCardMethodDto): Promise<CardMethodResponseDto> {
    this.logger.log(`Starting card registration for user: ${dto.userId}`);

    return await this.dbService.db.transaction(async (tx) => {
      try {
        // 1. 기존 기본 결제수단 해제 (필요한 경우)
        if (dto.isDefault) {
          await tx
            .update(schema.paymentMethod)
            .set({ isDefault: false })
            .where(
              and(
                eq(schema.paymentMethod.userId, dto.userId),
                eq(schema.paymentMethod.methodType, 'CARD')
              )
            );
        }

        // 2. HMS API를 통한 카드 등록
        const hmsResponse = await this.hmsCardService.registerCard(dto);
        
        // 3. 카드 유효성 검증 (0원 승인)
        const isValid = await this.hmsCardService.validateCard(hmsResponse.billingKey);
        if (!isValid) {
          throw new HttpException(
            '카드 유효성 검증에 실패했습니다',
            HttpStatus.BAD_REQUEST
          );
        }

        // 4. paymentMethod 테이블에 저장
        const [createdPaymentMethod] = await tx
          .insert(schema.paymentMethod)
          .values({
            id: ulid(),
            userId: dto.userId,
            methodType: 'CARD',
            methodName: dto.methodName,
            institutionCode: dto.institutionCode,
            isDefault: dto.isDefault || false,
            status: 'ACTIVE',
          })
          .returning();

        // 5. cardMethod 테이블에 카드 상세 정보 저장
        const [createdCardMethod] = await tx
          .insert(schema.cardMethod)
          .values({
            id: createdPaymentMethod.id,
            methodType: 'CARD',
            pgToken: hmsResponse.billingKey, // HMS에서는 pgToken과 billingKey가 동일
            billingKey: hmsResponse.billingKey,
            maskedCardNumber: hmsResponse.cardInfo.maskedNumber,
            lastFourDigits: hmsResponse.cardInfo.maskedNumber.slice(-4),
            cardBrand: hmsResponse.cardInfo.brand,
            cardType: hmsResponse.cardInfo.type,
            issuerName: hmsResponse.cardInfo.issuerName,
          })
          .returning();

        this.logger.log(`Card registered successfully with ID: ${createdPaymentMethod.id}`);

        // 6. 응답 DTO 생성
        return plainToClass(CardMethodResponseDto, {
          id: createdPaymentMethod.id,
          userId: createdPaymentMethod.userId,
          methodName: createdPaymentMethod.methodName,
          institutionCode: createdPaymentMethod.institutionCode,
          institutionName: createdCardMethod.issuerName || hmsResponse.cardInfo.issuerName,
          maskedCardNumber: createdCardMethod.maskedCardNumber,
          cardBrand: createdCardMethod.cardBrand,
          cardType: createdCardMethod.cardType || hmsResponse.cardInfo.type,
          isDefault: createdPaymentMethod.isDefault,
          isActive: createdPaymentMethod.status === 'ACTIVE',
          createdAt: createdPaymentMethod.createdAt,
          updatedAt: createdPaymentMethod.updatedAt,
        });

      } catch (error) {
        this.logger.error('Card registration failed:', error);
        
        if (error instanceof HttpException) {
          throw error;
        }
        
        throw new HttpException(
          '카드 등록 중 오류가 발생했습니다',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    });
  }

  /**
   * 사용자의 카드 결제수단 목록 조회
   */
  async getCardMethods(userId: number): Promise<CardMethodResponseDto[]> {
    try {
      const methods = await this.dbService.db.query.paymentMethod.findMany({
        where: and(
          eq(schema.paymentMethod.userId, userId),
          eq(schema.paymentMethod.methodType, 'CARD'),
          eq(schema.paymentMethod.status, 'ACTIVE')
        ),
        with: {
          card: true,
        },
        orderBy: (paymentMethod, { desc, sql }) => [
          desc(paymentMethod.isDefault),
          desc(paymentMethod.createdAt)
        ],
      });

      return methods.map(method => 
        plainToClass(CardMethodResponseDto, {
          id: method.id,
          userId: method.userId,
          methodName: method.methodName,
          institutionCode: method.institutionCode,
          institutionName: method.card?.issuerName || '카드사',
          maskedCardNumber: method.card?.maskedCardNumber || '',
          cardBrand: method.card?.cardBrand || '',
          cardType: method.card?.cardType || 'CREDIT',
          isDefault: method.isDefault,
          isActive: method.status === 'ACTIVE',
          createdAt: method.createdAt,
          updatedAt: method.updatedAt,
        })
      );
    } catch (error) {
      this.logger.error('Failed to get card methods:', error);
      throw new HttpException(
        '카드 목록 조회에 실패했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 카드 결제수단 삭제
   */
  async deleteCardMethod(userId: number, methodId: string): Promise<void> {
    return await this.dbService.db.transaction(async (tx) => {
      try {
        // 1. 결제수단 조회 (카드 정보 포함)
        const method = await tx.query.paymentMethod.findFirst({
          where: and(
            eq(schema.paymentMethod.id, methodId),
            eq(schema.paymentMethod.userId, userId),
            eq(schema.paymentMethod.methodType, 'CARD')
          ),
          with: {
            card: true,
          },
        });

        if (!method) {
          throw new HttpException(
            '결제수단을 찾을 수 없습니다',
            HttpStatus.NOT_FOUND
          );
        }

        // 2. HMS API에서 빌링키 해지
        if (method.card?.billingKey) {
          await this.hmsCardService.revokeBillingKey(method.card.billingKey);
        }

        // 3. DB에서 소프트 삭제 (status를 INACTIVE로 변경)
        await tx
          .update(schema.paymentMethod)
          .set({ 
            status: 'INACTIVE',
            isDefault: false,
            updatedAt: new Date()
          })
          .where(eq(schema.paymentMethod.id, methodId));

        this.logger.log(`Card method deleted: ${methodId}`);

      } catch (error) {
        this.logger.error('Failed to delete card method:', error);
        
        if (error instanceof HttpException) {
          throw error;
        }
        
        throw new HttpException(
          '카드 삭제 중 오류가 발생했습니다',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    });
  }

  /**
   * 기본 결제수단 설정
   */
  async setDefaultMethod(userId: number, methodId: string): Promise<void> {
    return await this.dbService.db.transaction(async (tx) => {
      try {
        // 1. 결제수단 존재 확인
        const method = await tx.query.paymentMethod.findFirst({
          where: and(
            eq(schema.paymentMethod.id, methodId),
            eq(schema.paymentMethod.userId, userId),
            eq(schema.paymentMethod.methodType, 'CARD'),
            eq(schema.paymentMethod.status, 'ACTIVE')
          ),
        });

        if (!method) {
          throw new HttpException(
            '결제수단을 찾을 수 없습니다',
            HttpStatus.NOT_FOUND
          );
        }

        // 2. 기존 기본 결제수단 해제
        await tx
          .update(schema.paymentMethod)
          .set({ isDefault: false })
          .where(
            and(
              eq(schema.paymentMethod.userId, userId),
              eq(schema.paymentMethod.methodType, 'CARD')
            )
          );

        // 3. 새로운 기본 결제수단 설정
        await tx
          .update(schema.paymentMethod)
          .set({ 
            isDefault: true,
            updatedAt: new Date()
          })
          .where(eq(schema.paymentMethod.id, methodId));

        this.logger.log(`Default method set: ${methodId}`);

      } catch (error) {
        this.logger.error('Failed to set default method:', error);
        
        if (error instanceof HttpException) {
          throw error;
        }
        
        throw new HttpException(
          '기본 결제수단 설정에 실패했습니다',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    });
  }
}