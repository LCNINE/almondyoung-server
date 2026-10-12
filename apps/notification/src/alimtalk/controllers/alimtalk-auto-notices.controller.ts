import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '@app/authorization';
import { LinkAlimtalkAutoNoticeDto } from '../dto';
import { AlimtalkAutoNoticesService } from '../services/alimtalk-auto-notices.service';

const AdminOnly = () => UseGuards(RolesGuard('admin', 'master'));

/** 알림톡으로 나가는 자동 알림과 그 알림이 쓰는 템플릿. 켜고 끄기는 이벤트 설정(`/events`)이 한다. */
@ApiTags('alimtalk')
@Controller('alimtalk/auto-notices')
export class AlimtalkAutoNoticesController {
  constructor(private readonly service: AlimtalkAutoNoticesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Put(':eventKey')
  @AdminOnly()
  link(@Param('eventKey') eventKey: string, @Body() dto: LinkAlimtalkAutoNoticeDto) {
    return this.service.link(eventKey, dto.templateCode, dto.replaceActive);
  }

  @Delete(':eventKey')
  @AdminOnly()
  unlink(@Param('eventKey') eventKey: string) {
    return this.service.unlink(eventKey);
  }
}
