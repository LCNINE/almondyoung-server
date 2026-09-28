import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import { AddSmsGroupRecipientsDto, CreateSmsRecipientGroupDto, ImportSupabaseGroupDto } from '../dto';
import { SmsGateEnabledGuard } from '../guards/sms-gate-enabled.guard';
import { SmsRecipientGroupsService } from '../services/sms-recipient-groups.service';

@ApiTags('sms-gate')
@Controller('sms-gate/recipient-groups')
@UseGuards(SmsGateEnabledGuard)
export class SmsRecipientGroupsController {
  constructor(private readonly service: SmsRecipientGroupsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateSmsRecipientGroupDto, @CurrentUser() user: { userId: string }) {
    return this.service.create(dto.name, user.userId);
  }

  @Post('import/supabase')
  importSupabase(@Body() dto: ImportSupabaseGroupDto, @CurrentUser() user: { userId: string }) {
    return this.service.importSupabase(dto, user.userId);
  }

  @Post(':id/recipients')
  addRecipients(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddSmsGroupRecipientsDto) {
    return this.service.addRecipients(id, dto);
  }

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
