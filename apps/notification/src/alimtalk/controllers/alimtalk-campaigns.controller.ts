import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard, RequirePermission, PiiResponse } from '@app/authorization';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { CreateAlimtalkCampaignDto, PreviewAlimtalkCampaignDto } from '../dto';
import { AlimtalkCampaignsService } from '../services/alimtalk-campaigns.service';

const AdminOnly = () => UseGuards(RolesGuard('admin', 'master'));

@ApiTags('alimtalk')
@Controller('alimtalk/campaigns')
export class AlimtalkCampaignsController {
  constructor(private readonly service: AlimtalkCampaignsService) {}

  @RequirePermission('messaging.message.read')
  @Get()
  list() {
    return this.service.list();
  }

  @RequirePermission('messaging.message.read')
  @Get('recipient-groups')
  recipientGroups() {
    return this.service.recipientGroups();
  }

  @RequirePermission('messaging.message.read')
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: PreviewAlimtalkCampaignDto) {
    return this.service.preview(dto);
  }

  @RequirePermission('messaging.message.bulk_send')
  @Post()
  @AdminOnly()
  create(@Body() dto: CreateAlimtalkCampaignDto, @CurrentUser() user: { userId: string }) {
    return this.service.create(dto, user.userId);
  }

  @PiiResponse({
    fields: { 'failures[].name': 'name', 'failures[].phone': 'phone' },
    subjects: [{ path: 'failures[].userId', type: 'user' }, { param: 'id', type: 'notification' }],
  })
  @RequirePermission('messaging.message.read')
  @Get(':id/results')
  results(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.results(id);
  }

  @RequirePermission('messaging.message.bulk_send')
  @Post(':id/stop')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  stop(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.stop(id);
  }
}
