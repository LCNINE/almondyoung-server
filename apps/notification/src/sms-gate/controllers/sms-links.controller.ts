import { Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { SmsCampaignsService } from '../services/sms-campaigns.service';

@ApiTags('sms-gate')
@Public()
@Controller('sms-gate/links')
export class SmsLinksController {
  constructor(private readonly service: SmsCampaignsService) {}

  @Post(':code/click')
  @HttpCode(HttpStatus.OK)
  click(@Param('code') code: string, @Headers('user-agent') userAgent?: string) {
    return this.service.click(code, userAgent);
  }
}
