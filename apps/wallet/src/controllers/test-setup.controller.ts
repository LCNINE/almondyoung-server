// controllers/test-setup.controller.ts
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { PaymentMethodService } from '../services/payment-methods.service';
import { BNPLService } from '../services/bnpl.service';
import { PointsService } from '../services/point.service';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import {
  CreateTestCardDto,
  CreateTestBnplDto,
  ChargePointsDto,
  TestPaymentMethodResponseDto,
  PointsResponseDto,
} from '../shared/dtos/test/test-setup.dto';

@ApiTags('🧪 테스트 설정')
@Controller('test-setup')
export class TestSetupController {
  private readonly logger = new Logger(TestSetupController.name);

  constructor(
    private readonly paymentMethodService: PaymentMethodService,
    private readonly bnplService: BNPLService,
    private readonly pointsService: PointsService,
    private readonly db: DbService<typeof schema>,
  ) {}

  @Post('payment-methods/card')
  @ApiOperation({
    summary: '테스트용 카드 결제수단 생성',
    description: `
테스트를 위한 가짜 카드 결제수단을 생성합니다.
실제 PG사 연동 없이 Mock 데이터로 동작합니다.

생성된 카드는 즉시결제에 사용됩니다.
    `,
  })
  @ApiResponse({
    status: 201,
    description: '테스트 카드가 성공적으로 생성되었습니다.',
    type: TestPaymentMethodResponseDto,
  })
  async createTestCard(
    @Body() dto: CreateTestCardDto,
  ): Promise<TestPaymentMethodResponseDto> {
    try {
      this.logger.log(`테스트 카드 생성: userId=${dto.userId}`);

      return await this.db.db.transaction(async (tx) => {
        // 1. 결제수단 생성
        const [paymentMethod] = await tx
          .insert(schema.paymentMethod)
          .values({
            userId: dto.userId,
            methodType: 'CARD',
            methodName: dto.methodName || '테스트 카드',
            status: 'ACTIVE',
          })
          .returning();

        // 2. 카드 정보 생성
        await tx.insert(schema.cardMethod).values({
          id: paymentMethod.id,
          methodType: 'CARD',
          pgToken: `test_token_${Date.now()}`,
          billingKey: `test_billing_${Math.random().toString(36).substring(2, 15)}`,
          maskedCardNumber: `**** **** **** ${(dto.cardNumber || '1234567890123456').slice(-4)}`,
          lastFourDigits: (dto.cardNumber || '1234567890123456').slice(-4),
          cardBrand: 'TEST',
          cardType: 'CREDIT',
          issuerName: 'Test Bank',
        });

        return {
          paymentMethodId: paymentMethod.id,
          methodType: paymentMethod.methodType,
          methodName: paymentMethod.methodName,
          status: paymentMethod.status,
          metadata: {
            cardNumber: dto.cardNumber || '1234567890123456',
            isTestCard: true,
          },
        };
      });
    } catch (error) {
      this.logger.error('테스트 카드 생성 실패', error);

      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message:
            error instanceof Error
              ? error.message
              : '테스트 카드 생성에 실패했습니다',
          error: 'Test Card Creation Failed',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('payment-methods/bnpl')
  @ApiOperation({
    summary: '테스트용 BNPL 결제수단 생성',
    description: `
테스트를 위한 BNPL 계정을 생성합니다.
실제 HMS 연동 없이 Mock 데이터로 동작합니다.

생성된 BNPL은 후불결제에 사용됩니다 (승인/확정 분리).
    `,
  })
  @ApiResponse({
    status: 201,
    description: '테스트 BNPL이 성공적으로 생성되었습니다.',
    type: TestPaymentMethodResponseDto,
  })
  async createTestBnpl(
    @Body() dto: CreateTestBnplDto,
  ): Promise<TestPaymentMethodResponseDto> {
    try {
      this.logger.log(`테스트 BNPL 생성: userId=${dto.userId}`);

      const result = await this.bnplService.registerMember({
        userId: dto.userId,
        methodName: dto.methodName || '테스트 BNPL',
        creditLimit: dto.creditLimit || 1000000,
        billingCycleDay: dto.billingCycleDay || 15,
        termsUrl: 'https://test.example.com/terms',
      });

      return {
        paymentMethodId: result.paymentMethodId,
        methodType: 'BNPL',
        methodName: result.methodName,
        status: result.status,
        metadata: {
          bnplAccountId: result.bnplAccountId,
          hmsMemberId: result.hmsMemberId,
          creditLimit: dto.creditLimit || 1000000,
          isTestBnpl: true,
        },
      };
    } catch (error) {
      this.logger.error('테스트 BNPL 생성 실패', error);

      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message:
            error instanceof Error
              ? error.message
              : '테스트 BNPL 생성에 실패했습니다',
          error: 'Test BNPL Creation Failed',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('points/charge')
  @ApiOperation({
    summary: '테스트용 포인트 충전',
    description: `
테스트를 위해 사용자에게 포인트를 충전합니다.
포인트 계정이 없으면 자동으로 생성됩니다.

충전된 포인트는 혼합 결제에서 사용할 수 있습니다.
    `,
  })
  @ApiResponse({
    status: 200,
    description: '포인트가 성공적으로 충전되었습니다.',
    type: PointsResponseDto,
  })
  async chargePoints(@Body() dto: ChargePointsDto): Promise<PointsResponseDto> {
    try {
      this.logger.log(
        `포인트 충전: userId=${dto.userId}, amount=${dto.amount}`,
      );

      return await this.db.db.transaction(async (tx) => {
        // 1. 포인트 계정 조회 또는 생성
        let [pointAccount] = await tx
          .select()
          .from(schema.points)
          .where(eq(schema.points.userId, dto.userId))
          .limit(1);

        if (!pointAccount) {
          [pointAccount] = await tx
            .insert(schema.points)
            .values({
              userId: dto.userId,
              balance: 0,
            })
            .returning();
        }

        // 2. 포인트 충전
        const result = await this.pointsService.earn(
          dto.userId,
          dto.amount,
          dto.reason || '테스트 포인트 충전',
          tx,
        );

        return {
          userId: dto.userId,
          balance: result.newBalance,
          charged: dto.amount,
          message: '포인트 충전 완료',
        };
      });
    } catch (error) {
      this.logger.error('포인트 충전 실패', error);

      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message:
            error instanceof Error
              ? error.message
              : '포인트 충전에 실패했습니다',
          error: 'Point Charge Failed',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('points/:userId')
  @ApiOperation({
    summary: '포인트 잔액 조회',
    description: '사용자의 현재 포인트 잔액을 조회합니다.',
  })
  @ApiParam({
    name: 'userId',
    description: '사용자 ID',
    example: 'user_123',
  })
  @ApiResponse({
    status: 200,
    description: '포인트 잔액 정보',
    type: PointsResponseDto,
  })
  async getPointBalance(
    @Param('userId') userId: string,
  ): Promise<PointsResponseDto> {
    try {
      const pointAccount = await this.pointsService.getBalance(userId);

      return {
        userId,
        balance: pointAccount.balance,
      };
    } catch (error) {
      this.logger.error(`포인트 잔액 조회 실패: ${userId}`, error);

      if (
        error instanceof Error &&
        error.message.includes('포인트 계정 없음')
      ) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: '포인트 계정이 없습니다. 먼저 포인트를 충전해주세요.',
            error: 'Point Account Not Found',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '포인트 잔액 조회 중 오류가 발생했습니다',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('payment-methods/:userId')
  @ApiOperation({
    summary: '사용자 결제수단 목록 조회',
    description: '사용자가 등록한 모든 결제수단을 조회합니다.',
  })
  @ApiParam({
    name: 'userId',
    description: '사용자 ID',
    example: 'user_123',
  })
  @ApiResponse({
    status: 200,
    description: '결제수단 목록',
    type: [TestPaymentMethodResponseDto],
  })
  async getUserPaymentMethods(
    @Param('userId') userId: string,
  ): Promise<TestPaymentMethodResponseDto[]> {
    try {
      const methods = await this.db.db
        .select()
        .from(schema.paymentMethod)
        .where(eq(schema.paymentMethod.userId, userId));

      return methods.map((method) => ({
        paymentMethodId: method.id,
        methodType: method.methodType,
        methodName: method.methodName,
        status: method.status,
      }));
    } catch (error) {
      this.logger.error(`결제수단 목록 조회 실패: ${userId}`, error);

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '결제수단 목록 조회 중 오류가 발생했습니다',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
