// payment-profile-v2.controller.ts - 정규화된 스키마용 컨트롤러
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { PaymentProfileV2Service } from '../../services/v2/payment-profile-v2.service';
import {
  PaymentProfileCreateV2RequestDto,
  PaymentProfileV2ResponseDto,
  PaymentProfileStatusUpdateDto,
} from '../../shared/dtos/payment-profile-v2.dto';

@ApiTags('Payment Profiles V2')
@Controller('v2/payment-profiles-v2')
export class PaymentProfileV2Controller {
  constructor(
    private readonly paymentProfileService: PaymentProfileV2Service,
  ) {}

  @Post()
  @ApiOperation({ summary: '결제프로필 생성 (정규화된 구조)' })
  @ApiResponse({ status: 201, type: PaymentProfileV2ResponseDto })
  async createProfile(
    @Body() dto: PaymentProfileCreateV2RequestDto,
  ): Promise<PaymentProfileV2ResponseDto> {
    try {
      return await this.paymentProfileService.createProfile(dto);
    } catch (error: any) {
      const message =
        error?.message || '결제프로필 생성 중 오류가 발생했습니다';

      // 에러 메시지 기반 HTTP 상태 코드 매핑
      if (message.includes('HMS') && message.includes('실패')) {
        throw new HttpException(
          `결제프로필 처리 중 오류가 발생했습니다: ${message}`,
          HttpStatus.BAD_REQUEST,
        );
      } else if (message.includes('중복')) {
        throw new HttpException(
          `결제프로필 처리 중 오류가 발생했습니다: ${message}`,
          HttpStatus.CONFLICT,
        );
      } else {
        throw new HttpException(
          `결제프로필 처리 중 오류가 발생했습니다: ${message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }

  @Get(':profileId')
  @ApiOperation({ summary: '결제프로필 조회' })
  @ApiResponse({ status: 200, type: PaymentProfileV2ResponseDto })
  async getProfile(
    @Param('profileId') profileId: string,
  ): Promise<PaymentProfileV2ResponseDto> {
    try {
      return await this.paymentProfileService.getProfileById(profileId);
    } catch (error: any) {
      const message = error?.message || '프로필 조회 중 오류가 발생했습니다';

      if (message.includes('찾을 수 없습니다')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      } else {
        throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
  }

  @Get('users/:userId')
  @ApiOperation({ summary: '사용자별 결제프로필 목록 조회' })
  @ApiResponse({ status: 200, type: [PaymentProfileV2ResponseDto] })
  async getProfilesByUser(
    @Param('userId') userId: string,
  ): Promise<PaymentProfileV2ResponseDto[]> {
    try {
      return await this.paymentProfileService.getProfilesByUserId(userId);
    } catch (error: any) {
      const message =
        error?.message || '프로필 목록 조회 중 오류가 발생했습니다';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put(':profileId/status')
  @ApiOperation({ summary: '결제프로필 상태 업데이트' })
  @ApiResponse({ status: 200, type: PaymentProfileV2ResponseDto })
  async updateProfileStatus(
    @Param('profileId') profileId: string,
    @Body() dto: PaymentProfileStatusUpdateDto,
  ): Promise<PaymentProfileV2ResponseDto> {
    try {
      return await this.paymentProfileService.updateProfileStatus(
        profileId,
        dto,
      );
    } catch (error: any) {
      const message =
        error?.message || '프로필 상태 업데이트 중 오류가 발생했습니다';

      if (message.includes('찾을 수 없습니다')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      } else {
        throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
  }

  @Delete(':profileId')
  @ApiOperation({ summary: '결제프로필 삭제' })
  @ApiResponse({ status: 204 })
  async deleteProfile(@Param('profileId') profileId: string): Promise<void> {
    try {
      await this.paymentProfileService.deleteProfile(profileId);
    } catch (error: any) {
      const message = error?.message || '프로필 삭제 중 오류가 발생했습니다';

      if (message.includes('찾을 수 없습니다')) {
        throw new HttpException(message, HttpStatus.NOT_FOUND);
      } else {
        throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
  }
}
