import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { CreateSmsTemplateDto, UpdateSmsTemplateDto } from '../dto';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';
import { SmsTemplatesService } from '../services/sms-templates.service';

@ApiTags('sms-gate')
@Controller('sms-gate/templates')
@UseGuards(SmsGateEnabledGuard)
export class SmsTemplatesController {
  constructor(private readonly service: SmsTemplatesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateSmsTemplateDto, @CurrentUser() user: { userId: string }) {
    return this.service.create(dto, user.userId);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSmsTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
