// controllers/v2/payment-profile.controller.ts

import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import {
  PaymentProfileCreateRequestDto,
  PaymentProfileResponseDto,
  UserPaymentProfilesResponseDto,
} from '../../shared/dtos/payment-profile.dto';
import { PaymentProfileService } from '../../services/v2/payment-profile.service';

/**
 * Payment Profile Controller v2
 *
 * 책임:
 * - 사용자 결제프로필 CRUD 관리
 * - HMS 연동 결제수단 등록/해지
 * - 프로필 상태 관리 (활성/비활성/만료)
 * - CTO 스타일 에러 핸들링
 */
@ApiTags('Payment Profiles v2')
@Controller('v2/payment-profiles')
export class PaymentProfileController {
  private readonly logger = new Logger(PaymentProfileController.name);

  constructor(private readonly paymentProfileService: PaymentProfileService) {}

  /**
   * 서비스에서 던진 Error를 HTTP 상태코드로 매핑 (CTO 스타일)
   */
  private mapErrorToHttpStatus(error: Error): HttpException {
    const message = error.message;

    if (
      message.includes('not found') ||
      message.includes('존재하지 않습니다')
    ) {
      return new HttpException(message, HttpStatus.NOT_FOUND);
    }
    if (
      message.includes('already exists') ||
      message.includes('이미 존재합니다')
    ) {
      return new HttpException(message, HttpStatus.CONFLICT);
    }
    if (
      message.includes('invalid') ||
      message.includes('잘못된') ||
      message.includes('validation')
    ) {
      return new HttpException(message, HttpStatus.BAD_REQUEST);
    }
    if (
      message.includes('unauthorized') ||
      message.includes('권한이 없습니다')
    ) {
      return new HttpException(message, HttpStatus.FORBIDDEN);
    }

    // 기본적으로 500 Internal Server Error
    return new HttpException(
      `결제프로필 처리 중 오류가 발생했습니다: ${message}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  /**
   * 결제프로필 등록
   */
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: '결제프로필 등록',
    description: '새로운 결제프로필을 등록합니다 (카드/CMS/BNPL)',
  })
  @ApiResponse({
    status: 200,
    description: '결제프로필 등록 성공',
    type: PaymentProfileResponseDto,
  })
  @ApiBadRequestResponse({
    description: '잘못된 요청 데이터',
  })
  @ApiInternalServerErrorResponse({
    description: '서버 내부 오류',
  })
  async createProfile(
    @Body() dto: PaymentProfileCreateRequestDto,
  ): Promise<PaymentProfileResponseDto> {
    this.logger.log(
      `결제프로필 등록 요청: userId=${dto.userId}, type=${dto.profileType}`,
    );

    try {
      return await this.paymentProfileService.createProfile(dto);
    } catch (error) {
      this.logger.error(`결제프로필 등록 실패: ${error.message}`, error.stack);
      throw this.mapErrorToHttpStatus(error);
    }
  }

  /**
   * 사용자 결제프로필 목록 조회
   */
  @Get('users/:userId')
  @ApiOperation({
    summary: '사용자 결제프로필 목록 조회',
    description: '특정 사용자의 모든 결제프로필을 조회합니다',
  })
  @ApiResponse({
    status: 200,
    description: '결제프로필 목록 조회 성공',
    type: UserPaymentProfilesResponseDto,
  })
  @ApiNotFoundResponse({
    description: '사용자를 찾을 수 없음',
  })
  async getUserProfiles(
    @Param('userId') userId: string,
    @Query('status') status?: string,
    @Query('type') profileType?: string,
  ): Promise<UserPaymentProfilesResponseDto> {
    this.logger.log(`사용자 결제프로필 목록 조회: userId=${userId}`);

    try {
      return await this.paymentProfileService.getUserProfiles(
        userId,
        status,
        profileType,
      );
    } catch (error) {
      this.logger.error(
        `결제프로필 목록 조회 실패: ${error.message}`,
        error.stack,
      );
      throw this.mapErrorToHttpStatus(error);
    }
  }

  /**
   * 결제프로필 단건 조회
   */
  @Get(':profileId')
  @ApiOperation({
    summary: '결제프로필 단건 조회',
    description: '특정 결제프로필의 상세 정보를 조회합니다',
  })
  @ApiResponse({
    status: 200,
    description: '결제프로필 조회 성공',
    type: PaymentProfileResponseDto,
  })
  @ApiNotFoundResponse({
    description: '결제프로필을 찾을 수 없음',
  })
  async getProfile(
    @Param('profileId') profileId: string,
  ): Promise<PaymentProfileResponseDto> {
    this.logger.log(`결제프로필 조회: profileId=${profileId}`);

    try {
      return await this.paymentProfileService.getProfile(profileId);
    } catch (error) {
      this.logger.error(`결제프로필 조회 실패: ${error.message}`, error.stack);
      throw this.mapErrorToHttpStatus(error);
    }
  }

  /**
   * 결제프로필 상태 변경 (활성/비활성)
   */
  @Put(':profileId/status')
  @HttpCode(200)
  @ApiOperation({
    summary: '결제프로필 상태 변경',
    description: '결제프로필의 상태를 변경합니다 (활성/비활성/차단)',
  })
  @ApiResponse({
    status: 200,
    description: '결제프로필 상태 변경 성공',
    type: PaymentProfileResponseDto,
  })
  @ApiNotFoundResponse({
    description: '결제프로필을 찾을 수 없음',
  })
  async updateProfileStatus(
    @Param('profileId') profileId: string,
    @Body() dto: { status: string; reason?: string },
  ): Promise<PaymentProfileResponseDto> {
    this.logger.log(
      `결제프로필 상태 변경: profileId=${profileId}, status=${dto.status}`,
    );

    try {
      return await this.paymentProfileService.updateProfileStatus(
        profileId,
        dto.status,
        dto.reason,
      );
    } catch (error) {
      this.logger.error(
        `결제프로필 상태 변경 실패: ${error.message}`,
        error.stack,
      );
      throw this.mapErrorToHttpStatus(error);
    }
  }

  /**
   * 결제프로필 삭제
   */
  @Delete(':profileId')
  @HttpCode(200)
  @ApiOperation({
    summary: '결제프로필 삭제',
    description: '결제프로필을 삭제합니다 (HMS 연동 해지 포함)',
  })
  @ApiResponse({
    status: 200,
    description: '결제프로필 삭제 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '결제프로필이 삭제되었습니다' },
      },
    },
  })
  @ApiNotFoundResponse({
    description: '결제프로필을 찾을 수 없음',
  })
  async deleteProfile(
    @Param('profileId') profileId: string,
    @Body() dto?: { reason?: string },
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`결제프로필 삭제: profileId=${profileId}`);

    try {
      await this.paymentProfileService.deleteProfile(
        profileId,
        dto?.reason || '사용자 요청',
      );

      return {
        success: true,
        message: '결제프로필이 삭제되었습니다',
      };
    } catch (error) {
      this.logger.error(`결제프로필 삭제 실패: ${error.message}`, error.stack);
      throw this.mapErrorToHttpStatus(error);
    }
  }
}
