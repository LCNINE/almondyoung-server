import {
  Controller,
  Post,
  Body,
  HttpStatus,
  HttpException,
  Logger,
  Get,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { PaymentSessionsService } from '../services/payment-sessions.service';
import {
  // CreateSessionDto,
  CreateSessionResponseDto,
} from '../shared/dtos/payments/create-session.dto';
import { CreatePaymentSessionDto } from '../shared/dtos/create-payment-session.dto';
// import { PaymentSessionNotFoundError } from '../shared/errors/payment.errors';

@ApiTags('💰 결제 세션 (청구서)')
@Controller('v2/sessions')
export class PaymentSessionsController {
  private readonly logger = new Logger(PaymentSessionsController.name);

  constructor(private readonly sessionService: PaymentSessionsService) {}

  @Post()
  @ApiOperation({
    summary: '결제 세션(청구서) 생성',
    description: `
결제 세션을 생성합니다. 세션은 청구서 역할도 담당합니다.

**청구서 기능:**
- 결제 전 금액/항목 확정
- 결제 세션 상태 관리  
- 만료 시간 설정
- 메타데이터로 주문 정보 보관

**다음 단계:**
1. 이 API로 세션(청구서) 생성
2. \`POST /v2/payments/process\`로 실제 결제 실행
    `,
  })
  @ApiResponse({
    status: 201,
    description: '결제 세션이 성공적으로 생성되었습니다.',
    type: CreateSessionResponseDto,
  })
  @ApiBadRequestResponse({
    description: '잘못된 요청 데이터',
    schema: {
      example: {
        statusCode: 400,
        message: ['amount must be a positive number'],
        error: 'Bad Request',
      },
    },
  })
  async createSession(
    @Body() dto: CreatePaymentSessionDto,
  ): Promise<CreateSessionResponseDto> {
    try {
      this.logger.log(
        `결제 세션(청구서) 생성: userId=${dto.userId}, amount=${dto.amount}`,
      );

      // 기존의 우수한 createSession 메서드 직접 사용 (멱등성, 이벤트, 트랜잭션 지원)
      const result = await this.sessionService.createSession({
        userId: dto.userId,
        amount: dto.amount,
        currency: dto.currency || 'KRW',
        metadata: dto.metadata,
      });

      // 세션 정보를 직접 조회해서 완전한 정보 반환
      const session = await this.sessionService.getSession(result.sessionId);

      // design.md 스타일: checkout URL 포함
      const checkoutUrl = `http://localhost:5500/checkout-v2.html?sessionId=${session.id}&returnUrl=${encodeURIComponent(dto.metadata?.returnUrl || '')}`;

      return {
        sessionId: session.id,
        userId: session.userId,
        amount: session.amount,
        currency: session.currency,
        status: session.status,
        expiresAt: session.expiresAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        // ✅ design.md 기반 checkout URL 추가
        checkout: {
          url: checkoutUrl,
          phase: 'CHECKOUT',
        },
        phase: session.status, // design.md 호환성
      };
    } catch (error) {
      this.logger.error('결제 세션 생성 실패', error);

      if (error instanceof Error) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: error.message,
            error: 'Session Creation Failed',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '결제 세션 생성 중 오류가 발생했습니다',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':sessionId')
  @ApiOperation({
    summary: '결제 세션(청구서) 조회',
    description: `
결제 세션의 현재 상태를 조회합니다.
**청구서로서 제공하는 정보:**
- 결제 금액 및 통화
- 결제 상태 (PENDING, AUTHORIZED, CAPTURED 등)
- 세션 만료 시간
- 주문 메타데이터
    `,
  })
  @ApiParam({
    name: 'sessionId',
    description: '결제 세션 ID',
    example: '01K44CZBZ1DB5Z2N4KR8M7C7EA',
  })
  @ApiResponse({
    status: 200,
    description: '결제 세션 정보',
    type: CreateSessionResponseDto,
  })
  @ApiNotFoundResponse({
    description: '결제 세션을 찾을 수 없음',
  })
  async getSession(
    @Param('sessionId') sessionId: string,
  ): Promise<CreateSessionResponseDto> {
    try {
      const sessionResult = await this.sessionService.getSession(sessionId);

      const session = sessionResult; // PaymentSession 타입으로 단언

      return {
        sessionId: session.id,
        userId: session.userId,
        amount: Number(session.amount),
        currency: session.currency,
        status: session.status,
        expiresAt: session.expiresAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        checkout: {
          url: `http://localhost:3000/checkout-v2.html?sessionId=${session.id}&returnUrl=http://localhost:3000/redirect.html`,
          phase: 'CHECKOUT',
        },
      };
    } catch (error) {
      this.logger.error(`결제 세션 조회 실패: ${sessionId}`, error);

      // 비즈니스 예외를 HTTP 상태 코드로 매핑
      if (error instanceof Error) {
        // Nest.js NotFoundException을 404로 변환
        if (
          error.constructor.name === 'NotFoundException' ||
          error.message.includes('찾을 수 없습니다')
        ) {
          throw new HttpException(
            {
              statusCode: HttpStatus.NOT_FOUND,
              message: error.message,
              error: 'Not Found',
            },
            HttpStatus.NOT_FOUND,
          );
        }

        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: error.message,
            error: 'Session Processing Failed',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: '결제 세션 조회 중 오류가 발생했습니다',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
