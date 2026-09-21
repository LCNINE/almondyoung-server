import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { CreateSmsCampaignDto, PreviewSmsCampaignDto } from '../dto';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';
import { SmsCampaignsService } from '../services/sms-campaigns.service';

@ApiTags('sms-gate')
@Controller('sms-gate/campaigns')
@UseGuards(SmsGateEnabledGuard)
export class SmsCampaignsController {
  constructor(private readonly service: SmsCampaignsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('audience')
  audience() {
    return this.service.audience();
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: PreviewSmsCampaignDto) {
    return this.service.preview(dto);
  }

  @Post()
  create(@Body() dto: CreateSmsCampaignDto, @CurrentUser() user: { userId: string }) {
    return this.service.create(dto, user.userId);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  stop(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.stop(id);
  }
}
