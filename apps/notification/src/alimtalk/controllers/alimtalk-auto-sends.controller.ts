import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AlimtalkAutoSendsService } from '../services/alimtalk-auto-sends.service';

/** 사건이 생겨 자동으로 나간 알림톡의 기록(관리자 캠페인과 별개). 읽기만 한다. */
@ApiTags('alimtalk')
@Controller('alimtalk/auto-sends')
export class AlimtalkAutoSendsController {
  constructor(private readonly service: AlimtalkAutoSendsService) {}

  @Get()
  list(@Query('before') before?: string) {
    if (before === undefined) return this.service.list();
    const at = new Date(before);
    if (Number.isNaN(at.getTime())) throw new BadRequestException('before 는 ISO 날짜여야 합니다.');
    return this.service.list(at);
  }

  @Get(':id/result')
  result(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.result(id);
  }
}
