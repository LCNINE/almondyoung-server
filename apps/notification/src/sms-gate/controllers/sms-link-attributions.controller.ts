import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StoreRoute } from '@app/authorization';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { CreateSmsLinkAttributionDto } from '../dto';
import { SmsCampaignsService } from '../services/sms-campaigns.service';

// 쇼핑몰이 «추적 링크를 누른 브라우저의 계정»을 알릴 때 부른다. 계정은 토큰에서만 읽는다.
// SmsLinksController 는 클래스 전체가 @Public 이라 여기 두면 인증이 빠진다 — 그래서 따로 둔다.
// 외부 서비스로 보낸 링크도 받으므로 SmsGateEnabledGuard(발송폰 설정)는 붙이지 않는다.
@ApiTags('sms-gate')
@StoreRoute()
@Controller('sms-gate/links')
export class SmsLinkAttributionsController {
  constructor(private readonly service: SmsCampaignsService) {}

  @Post(':code/attributions')
  @HttpCode(HttpStatus.NO_CONTENT)
  attribute(
    @Param('code') code: string,
    @Body() dto: CreateSmsLinkAttributionDto,
    @CurrentUser() user: { userId: string },
  ): Promise<void> {
    return this.service.attribute(code, user.userId, dto.kind);
  }
}
