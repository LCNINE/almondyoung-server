import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  HttpException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
  ApiConsumes,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { PaymentService } from '../services/payment.service';
import { CreateBNPLMethodDto } from '../shared/dtos/bnpl/create-bnpl-method.dto';
import { SubmitConsentDto } from '../shared/dtos/bnpl/submit-consent.dto';

/**
 * BNPL 전용 컨트롤러 v3.2
 * - Hybrid Approach: /payment-methods/recurring/bnpl로 통합
 * - BNPL 회원 등록, 출금동의서 제출, 상태 조회 등 BNPL만의 특수 프로세스 관리
 * - PaymentService Facade Pattern으로 통합 처리
 */
@ApiTags('BNPL 관리')
@Controller('payment-methods')
export class BnplController {
  private readonly logger = new Logger(BnplController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Post('recurring/bnpl')
  @HttpCode(201)
  @ApiOperation({
    summary: '정기결제용 BNPL 등록',
    description: 'HMS BNPL 시스템에 신규 회원을 등록합니다.',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: '멱등성 키 (선택사항)',
  })
  @ApiResponse({
    status: 201,
    description: 'BNPL 회원 등록 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        paymentMethodId: {
          type: 'string',
          example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
        },
        hmsMemberId: { type: 'string', example: 'HMS_BNPL_123456789' },
        status: { type: 'string', example: 'PENDING' },
        message: { type: 'string', example: 'BNPL 회원 등록 완료' },
        creditLimit: { type: 'number', example: 500000 },
        nextSteps: {
          type: 'array',
          items: { type: 'string' },
          example: ['출금동의서 제출 필요'],
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: '잘못된 요청 데이터 또는 HMS API 에러',
  })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async registerBnplMember(
    @Body() dto: CreateBNPLMethodDto,
    @Headers('idempotency-key') idemKey?: string,
  ) {
    try {
      const result = await this.paymentService.registerPaymentMethod(
        'BNPL',
        dto,
        idemKey,
      );

      if (!result.success) {
        throw new BadRequestException(result.error);
      }

      return {
        success: true,
        paymentMethodId: result.paymentMethodId,
        hmsMemberId: result.hmsMemberId,
        status: 'PENDING',
        message: 'BNPL 회원 등록 완료',
        creditLimit: dto.creditLimit || 500000,
        nextSteps: ['출금동의서 제출 필요'],
      };
    } catch (error) {
      this.logger.error('BNPL 회원 등록 실패', error);

      if (error.message?.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (
        error.message?.includes('required') ||
        error.message?.includes('invalid') ||
        error.message?.includes('already') ||
        error.message?.includes('failed')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        'BNPL 회원 등록 중 알 수 없는 오류가 발생했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':memberId/consent')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'BNPL 출금동의서 제출',
    description: 'BNPL 회원의 출금동의서 파일을 HMS에 제출합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({
    name: 'memberId',
    description: 'HMS BNPL Member ID',
    example: 'HMS_BNPL_123456789',
  })
  @ApiResponse({
    status: 200,
    description: '출금동의서 제출 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        agreementId: { type: 'string', example: 'AGR_123456789' },
        message: {
          type: 'string',
          example: '출금동의서가 성공적으로 제출되었습니다',
        },
        nextSteps: {
          type: 'array',
          items: { type: 'string' },
          example: ['HMS 심사 진행 중', '2-3일 소요 예상'],
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: '파일 누락 또는 잘못된 파일 형식',
  })
  @ApiNotFoundResponse({ description: 'BNPL 회원 ID를 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async submitConsent(
    @Param('memberId') memberId: string,
    @UploadedFile() file: any,
    @Body() dto: SubmitConsentDto,
  ) {
    try {
      if (!file) {
        throw new BadRequestException('출금동의서 파일이 필요합니다');
      }

      // 파일 형식 검증
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new BadRequestException(
          '지원하지 않는 파일 형식입니다. PDF, JPG, PNG만 가능합니다.',
        );
      }

      // 파일 크기 검증 (10MB 제한)
      if (file.size > 10 * 1024 * 1024) {
        throw new BadRequestException('파일 크기는 10MB 이하여야 합니다');
      }

      this.logger.log(
        `BNPL 출금동의서 제출: ${memberId}, 파일: ${file.originalname}`,
      );

      const result = await this.paymentService.submitConsent(
        memberId,
        file.buffer,
        file.originalname,
      );

      if (!result.success) {
        throw new BadRequestException(result.error);
      }

      return {
        success: true,
        agreementId: result.agreementId,
        message: '출금동의서가 성공적으로 제출되었습니다',
        nextSteps: ['HMS 심사 진행 중', '2-3일 소요 예상'],
      };
    } catch (error) {
      this.logger.error('BNPL 출금동의서 제출 실패', error);

      if (error.message?.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      if (
        error.message?.includes('required') ||
        error.message?.includes('invalid') ||
        error.message?.includes('size') ||
        error.message?.includes('format')
      ) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(
        'BNPL 출금동의서 제출 중 알 수 없는 오류가 발생했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':memberId/status')
  @ApiOperation({
    summary: 'BNPL 회원 상태 조회',
    description: 'HMS BNPL 회원의 현재 상태를 조회합니다.',
  })
  @ApiParam({
    name: 'memberId',
    description: 'HMS BNPL Member ID',
    example: 'HMS_BNPL_123456789',
  })
  @ApiResponse({
    status: 200,
    description: 'BNPL 회원 상태 조회 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        status: { type: 'string', example: 'ACTIVE' },
        hmsStatus: { type: 'string', example: 'REGISTERED' },
        creditLimit: { type: 'number', example: 500000 },
        approvedLimit: { type: 'number', example: 500000 },
        registeredAt: { type: 'string', example: '2024-01-15T10:30:00Z' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'BNPL 회원 ID를 찾을 수 없음' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async getBnplMemberStatus(@Param('memberId') memberId: string) {
    try {
      const result = await this.paymentService.getMemberStatus(
        'BNPL',
        memberId,
      );

      if (!result.success) {
        throw new BadRequestException(result.error);
      }

      return {
        success: true,
        status: result.status,
        hmsStatus: result.hmsStatus,
        ...result.metadata,
      };
    } catch (error) {
      this.logger.error('BNPL 회원 상태 조회 실패', error);

      if (error.message?.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }

      throw new HttpException(
        'BNPL 회원 상태 조회 중 알 수 없는 오류가 발생했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
