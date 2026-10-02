import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LookupMembershipNoticesDto } from '../dto';
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

  /** 멤버십 요금 안내(회차 실패·해지)가 나갔는지 한꺼번에 — 출금 실패·미납 현황 화면이 묻는다. 읽기만 한다 */
  @Post('membership-notices/lookup')
  @HttpCode(HttpStatus.OK)
  lookupMembershipNotices(@Body() dto: LookupMembershipNoticesDto) {
    return this.service.lookupMembershipNotices(dto);
  }

  @Get(':id/result')
  result(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.result(id);
  }
}
