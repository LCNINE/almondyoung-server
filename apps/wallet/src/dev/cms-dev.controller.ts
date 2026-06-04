import { Body, Controller, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';
import { CmsDevStateService, DevCmsStateResponseDto } from './cms-dev-state.service';

class IdTypeDto {
  @ApiProperty({ enum: ['cmsMemberId', 'id', 'billingMethodId'], default: 'cmsMemberId' })
  @IsOptional()
  @IsEnum(['cmsMemberId', 'id', 'billingMethodId'])
  idType?: 'cmsMemberId' | 'id' | 'billingMethodId';
}

class MarkRegisteredDto extends IdTypeDto {
  @ApiProperty({ enum: ['leave', 'register', 'fail'], default: 'register' })
  @IsOptional()
  @IsEnum(['leave', 'register', 'fail'])
  agreement?: 'leave' | 'register' | 'fail';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  resultCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  resultMessage?: string;
}

class MarkFailedDto extends IdTypeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  resultCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  resultMessage?: string;
}

/**
 * dev/test 전용 CMS 상태 강제 전환 controller.
 *
 * ENABLE_DEV_CMS_HELPERS=true + NODE_ENV !== 'production' 인 경우에만 동작.
 * 그 외에는 404를 반환하여 endpoint 존재 자체를 숨긴다.
 * 관리자 수동 poll (POST /v1/admin/recurring-billing/providers/cms/members/:id/poll) 과 역할이 다름:
 *   - 수동 poll: 효성 API를 호출하여 실제 상태 동기화
 *   - dev helper: 효성 API 호출 없이 DB 상태만 강제 전환 (테스트용)
 */
@ApiTags('Dev - CMS State Helpers')
@WalletAdminAuth()
@Controller('v1/dev/cms-members')
export class CmsDevController {
  constructor(private readonly service: CmsDevStateService) {}

  private assertDevEnabled(): void {
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEV_CMS_HELPERS !== 'true') {
      throw new NotFoundException();
    }
  }

  @Post(':id/mark-registered')
  @HttpCode(200)
  @ApiOperation({
    summary: '[DEV ONLY] CMS 회원 REGISTERED 전환 + 동의자료 상태 선택적 갱신',
    description: 'ENABLE_DEV_CMS_HELPERS=true 환경에서만 동작. 효성 API 호출 없이 DB 상태만 변경.',
  })
  async markRegistered(
    @Param('id') id: string,
    @Body() body: MarkRegisteredDto,
  ): Promise<DevCmsStateResponseDto> {
    this.assertDevEnabled();
    return this.service.markMemberRegistered(
      id,
      body.idType ?? 'cmsMemberId',
      body.agreement ?? 'register',
      body.resultCode,
      body.resultMessage,
    );
  }

  @Post(':id/mark-failed')
  @HttpCode(200)
  @ApiOperation({
    summary: '[DEV ONLY] CMS 회원 FAILED 전환',
    description: 'ENABLE_DEV_CMS_HELPERS=true 환경에서만 동작. 효성 API 호출 없이 DB 상태만 변경.',
  })
  async markFailed(
    @Param('id') id: string,
    @Body() body: MarkFailedDto,
  ): Promise<DevCmsStateResponseDto> {
    this.assertDevEnabled();
    return this.service.markMemberFailed(id, body.idType ?? 'cmsMemberId', body.resultCode, body.resultMessage);
  }

  @Post(':id/mark-agreement-registered')
  @HttpCode(200)
  @ApiOperation({
    summary: '[DEV ONLY] CMS 동의자료 등록 상태로 전환',
    description: 'ENABLE_DEV_CMS_HELPERS=true 환경에서만 동작. cms_members.status는 그대로 유지.',
  })
  async markAgreementRegistered(
    @Param('id') id: string,
    @Body() body: IdTypeDto,
  ): Promise<DevCmsStateResponseDto> {
    this.assertDevEnabled();
    return this.service.markAgreementRegistered(id, body.idType ?? 'cmsMemberId');
  }

  @Post(':id/mark-agreement-failed')
  @HttpCode(200)
  @ApiOperation({
    summary: '[DEV ONLY] CMS 동의자료 실패 상태로 전환',
    description: 'ENABLE_DEV_CMS_HELPERS=true 환경에서만 동작. 관리자 처리 필요 상태 시뮬레이션.',
  })
  async markAgreementFailed(
    @Param('id') id: string,
    @Body() body: MarkFailedDto,
  ): Promise<DevCmsStateResponseDto> {
    this.assertDevEnabled();
    return this.service.markAgreementFailed(id, body.idType ?? 'cmsMemberId', body.resultCode, body.resultMessage);
  }

  @Post(':id/reset-to-pending')
  @HttpCode(200)
  @ApiOperation({
    summary: '[DEV ONLY] CMS 회원 PENDING으로 리셋',
    description: 'ENABLE_DEV_CMS_HELPERS=true 환경에서만 동작. 신규 등록 상태 재시뮬레이션.',
  })
  async resetToPending(
    @Param('id') id: string,
    @Body() body: IdTypeDto,
  ): Promise<DevCmsStateResponseDto> {
    this.assertDevEnabled();
    return this.service.resetToPending(id, body.idType ?? 'cmsMemberId');
  }
}
