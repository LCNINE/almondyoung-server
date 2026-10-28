import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { LinkAlimtalkAutoNoticeDto } from '../dto';
import { AlimtalkAutoNoticesService } from '../services/alimtalk-auto-notices.service';

/** 알림톡으로 나가는 자동 알림과 그 알림이 쓰는 템플릿. 켜고 끄기는 이벤트 설정(`/events`)이 한다. */
@ApiTags('alimtalk')
@Controller('alimtalk/auto-notices')
export class AlimtalkAutoNoticesController {
  constructor(private readonly service: AlimtalkAutoNoticesService) {}

  @RequirePermission('messaging.message.read')
  @Get()
  list() {
    return this.service.list();
  }

  @RequirePermission('messaging.template.write')
  @Put(':eventKey')
  link(@Param('eventKey') eventKey: string, @Body() dto: LinkAlimtalkAutoNoticeDto) {
    return this.service.link(eventKey, dto.templateCode, dto.replaceActive);
  }

  @RequirePermission('messaging.template.write')
  @Delete(':eventKey')
  unlink(@Param('eventKey') eventKey: string) {
    return this.service.unlink(eventKey);
  }
}
