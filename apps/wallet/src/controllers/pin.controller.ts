import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  Logger,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard, User } from '@app/authorization';
import { PinService } from '../services/pin/pin.service';
import { FastifyRequest } from 'fastify';

/**
 * PIN Controller
 *
 * 결제 비밀번호(PIN) 관리 API
 */
@ApiTags('결제 비밀번호 (Payment PIN)')
@Controller('/payments/pin')
@UseGuards(JwtAuthGuard)
export class PinController {
  private readonly logger = new Logger(PinController.name);

  constructor(
    private readonly pinService: PinService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /payments/pin/status
   * PIN 상태 조회
   */
  @Get('status')
  @ApiOperation({
    summary: 'PIN 상태 조회',
    description: '사용자의 PIN 등록 여부, 잠금 상태, 실패 횟수를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'PIN 상태 조회 성공',
    schema: {
      example: {
        hasPin: true,
        status: 'ACTIVE',
        failureCount: 0,
      },
    },
  })
  async getStatus(@User('userId') userId: string) {
    try {
      return await this.pinService.getStatus(userId);
    } catch (error) {
      this.handleError(error, 'PIN 상태 조회');
    }
  }

  /**
   * POST /payments/pin/register
   * PIN 등록
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'PIN 등록',
    description: '6자리 숫자 PIN을 등록합니다. 보안 정책에 따라 연속/반복 숫자는 거부됩니다.',
  })
  @ApiResponse({
    status: 201,
    description: 'PIN 등록 성공',
  })
  @ApiResponse({
    status: 400,
    description: '보안 정책 위반 (WEAK_PIN)',
    schema: {
      example: {
        code: 'WEAK_PIN',
        message: '연속된 숫자나 반복된 숫자는 사용할 수 없습니다.',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: '이미 등록된 PIN 존재',
    schema: {
      example: {
        code: 'PIN_ALREADY_EXISTS',
        message: '이미 등록된 PIN이 있습니다.',
      },
    },
  })
  async register(@User('userId') userId: string, @Body() body: { pin: string }, @Req() req: FastifyRequest) {
    try {
      const forwardedFor = req.headers['x-forwarded-for'];
      const ipAddress = req.ip || (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) || undefined;
      await this.pinService.register(userId, body.pin, ipAddress);
      return { success: true };
    } catch (error) {
      this.handleError(error, 'PIN 등록');
    }
  }

  /**
   * POST /payments/pin/verify
   * PIN 검증
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PIN 검증',
    description: '입력된 PIN을 검증합니다. 5회 연속 실패 시 계정이 잠깁니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'PIN 검증 성공',
    schema: {
      example: {
        verified: true,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'PIN 불일치',
    schema: {
      example: {
        code: 'PIN_MISMATCH',
        message: '비밀번호가 일치하지 않습니다.',
        data: {
          currentFailureCount: 3,
          maxFailureCount: 5,
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'PIN 잠금',
    schema: {
      example: {
        code: 'PIN_LOCKED',
        message: '비밀번호 입력 횟수를 초과하여 잠겼습니다. 재설정이 필요합니다.',
      },
    },
  })
  async verify(@User('userId') userId: string, @Body() body: { pin: string }, @Req() req: FastifyRequest) {
    try {
      const forwardedFor = req.headers['x-forwarded-for'];
      const ipAddress = req.ip || (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) || undefined;
      const userAgent = req.headers['user-agent'] || undefined;
      const verified = await this.pinService.verify(userId, body.pin, ipAddress, userAgent);
      return { verified };
    } catch (error) {
      this.handleError(error, 'PIN 검증');
    }
  }

  /**
   * POST /payments/pin/reset
   * PIN 재설정 (본인인증 토큰 필요)
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PIN 재설정',
    description: '본인인증 토큰을 통해 PIN을 재설정합니다.',
  })
  @ApiHeader({
    name: 'x-verification-token',
    description: '본인인증 완료 토큰',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'PIN 재설정 성공',
  })
  @ApiResponse({
    status: 400,
    description: '보안 정책 위반 또는 토큰 유효성 검사 실패',
  })
  async reset(
    @User('userId') userId: string,
    @Body() body: { newPin: string },
    @Headers('x-verification-token') verificationToken: string,
    @Req() req: FastifyRequest,
  ) {
    try {
      // 1. 토큰 존재 확인
      if (!verificationToken) {
        throw new Error('Verification token required');
      }

      // 2. JWT 검증 (서명, 만료 시간)
      let payload: { sub: string; scopes?: string[]; purpose?: string };
      try {
        payload = await this.jwtService.verifyAsync(verificationToken, {
          secret: this.configService.getOrThrow<string>('AUTH_SECRET'),
        });
      } catch (error) {
        throw new Error('Invalid or expired verification token');
      }

      // 3. Scope 확인 (PIN_RESET 포함 여부)
      if (!payload.scopes || !payload.scopes.includes('PIN_RESET')) {
        throw new Error('Token does not have PIN_RESET scope');
      }

      // 4. Purpose 확인
      if (payload.purpose !== 'pin_reset') {
        throw new Error('Token purpose mismatch');
      }

      // 5. 사용자 ID 일치 확인
      if (payload.sub !== userId) {
        throw new Error('Token user ID mismatch');
      }

      // 6. PIN 재설정 실행
      const forwardedFor = req.headers['x-forwarded-for'];
      const ipAddress = req.ip || (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) || undefined;
      await this.pinService.reset(userId, body.newPin, ipAddress);
      return { success: true };
    } catch (error) {
      this.handleError(error, 'PIN 재설정');
    }
  }

  /**
   * POST /payments/pin/change
   * PIN 변경
   */
  @Post('change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PIN 변경',
    description: '현재 PIN을 알고 있을 때 새 PIN으로 변경합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'PIN 변경 성공',
  })
  @ApiResponse({
    status: 400,
    description: '보안 정책 위반 또는 현재 PIN 불일치',
  })
  async change(
    @User('userId') userId: string,
    @Body() body: { currentPin: string; newPin: string },
    @Req() req: FastifyRequest,
  ) {
    try {
      const forwardedFor = req.headers['x-forwarded-for'];
      const ipAddress = req.ip || (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) || undefined;
      await this.pinService.change(userId, body.currentPin, body.newPin, ipAddress);
      return { success: true };
    } catch (error) {
      this.handleError(error, 'PIN 변경');
    }
  }

  /**
   * 에러 처리 (NestJS 레이어 패턴)
   * Service에서 던진 Error를 HTTP Exception으로 변환
   */
  private handleError(error: any, context: string): never {
    this.logger.error(`${context} 실패: ${error.message}`, error.stack);

    const message = error.message || 'PIN 처리 중 오류가 발생했습니다';

    // 문자열 패턴 기반 에러 매핑 (CTO 스타일)
    const lowerMessage = message.toLowerCase();

    // 400: PIN 미등록
    if (lowerMessage.includes('pin_not_registered')) {
      throw new BadRequestException({
        code: 'PIN_NOT_REGISTERED',
        message: 'PIN이 등록되지 않았습니다.',
      });
    }

    // 400: 보안 정책 위반
    if (lowerMessage.includes('weak_pin')) {
      throw new BadRequestException({
        code: 'WEAK_PIN',
        message: '연속된 숫자나 반복된 숫자는 사용할 수 없습니다.',
      });
    }

    // 409: 이미 등록됨
    if (lowerMessage.includes('pin_already_exists')) {
      throw new ConflictException({
        code: 'PIN_ALREADY_EXISTS',
        message: '이미 등록된 PIN이 있습니다.',
      });
    }

    // 401: PIN 불일치 (실패 횟수 정보 포함)
    if (lowerMessage.includes('pin_mismatch')) {
      const parts = message.split(':');
      const currentCount = parts.length > 1 ? parseInt(parts[1], 10) : 0;
      const maxCount = parts.length > 2 ? parseInt(parts[2], 10) : 5;

      throw new UnauthorizedException({
        code: 'PIN_MISMATCH',
        message: '비밀번호가 일치하지 않습니다.',
        data: {
          currentFailureCount: currentCount,
          maxFailureCount: maxCount,
        },
      });
    }

    // 403: PIN 잠금
    if (lowerMessage.includes('pin_locked')) {
      throw new ForbiddenException({
        code: 'PIN_LOCKED',
        message: '비밀번호 입력 횟수를 초과하여 잠겼습니다. 재설정이 필요합니다.',
      });
    }

    // 400: 현재 PIN과 동일
    if (lowerMessage.includes('pin_same_as_current')) {
      throw new BadRequestException({
        code: 'PIN_SAME_AS_CURRENT',
        message: '새 PIN은 현재 PIN과 달라야 합니다.',
      });
    }

    // 400: 토큰 관련
    if (lowerMessage.includes('token') || lowerMessage.includes('verification')) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: '인증 토큰이 유효하지 않습니다.',
      });
    }

    // 기타 에러는 400
    throw new BadRequestException({
      code: 'UNKNOWN_ERROR',
      message,
    });
  }
}
