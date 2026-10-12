import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { ContinueSmsCampaignDto, CreateSmsCampaignDto, PreviewSmsCampaignDto } from '../dto';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';
import { SmsCampaignsService } from '../services/sms-campaigns.service';
import { RequirePermission } from '@app/authorization';

@ApiTags('sms-gate')
@Controller('sms-gate/campaigns')
@UseGuards(SmsGateEnabledGuard)
export class SmsCampaignsController {
  constructor(private readonly service: SmsCampaignsService) {}

  @RequirePermission('messaging.message.read')
  @Get()
  list() {
    return this.service.list();
  }

  @RequirePermission('messaging.message.read')
  @Get('audience')
  audience() {
    return this.service.audience();
  }

  @RequirePermission('messaging.message.read')
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: PreviewSmsCampaignDto) {
    return this.service.preview(dto);
  }

  @RequirePermission('messaging.message.bulk_send')
  @Post()
  create(@Body() dto: CreateSmsCampaignDto, @CurrentUser() user: { userId: string }) {
    return this.service.create(dto, user.userId);
  }

  @RequirePermission('messaging.message.read')
  @Get(':id/clicks')
  clicks(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.clicks(id);
  }

  @RequirePermission('messaging.message.bulk_send')
  @Post(':id/continue')
  continueWith(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContinueSmsCampaignDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.service.continueWith(id, dto, user.userId);
  }

  @RequirePermission('messaging.message.bulk_send')
  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  stop(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.stop(id);
  }
}
