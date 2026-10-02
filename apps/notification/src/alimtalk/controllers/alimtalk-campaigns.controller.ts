import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '@app/authorization';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { CreateAlimtalkCampaignDto, PreviewAlimtalkCampaignDto } from '../dto';
import { AlimtalkCampaignsService } from '../services/alimtalk-campaigns.service';

const AdminOnly = () => UseGuards(RolesGuard('admin', 'master'));

@ApiTags('alimtalk')
@Controller('alimtalk/campaigns')
export class AlimtalkCampaignsController {
  constructor(private readonly service: AlimtalkCampaignsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('recipient-groups')
  recipientGroups() {
    return this.service.recipientGroups();
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: PreviewAlimtalkCampaignDto) {
    return this.service.preview(dto);
  }

  @Post()
  @AdminOnly()
  create(@Body() dto: CreateAlimtalkCampaignDto, @CurrentUser() user: { userId: string }) {
    return this.service.create(dto, user.userId);
  }

  @Get(':id/results')
  results(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.results(id);
  }

  @Post(':id/stop')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  stop(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.stop(id);
  }
}
