import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from 'apps/user-service/database/drizzle/schema';
import { GrowthNoteTargetDto, RecordGrowthNoteDto } from './dto/growth-note.dto';
import { GrowthNotesService } from './growth-notes.service';

@ApiTags('뷰티탑 성장 노트')
@ApiBearerAuth('access-token')
@Controller('beautytop/growth-notes')
@UseGuards(AuthGuard('jwt'))
export class GrowthNotesController {
  constructor(private readonly service: GrowthNotesService) {}

  @ApiOperation({ summary: '본인 샵의 최근 실행 기록 조회' })
  @Get()
  list(@CurrentUser() user: User, @Query() target: GrowthNoteTargetDto) {
    return this.service.list(user.id, target);
  }

  @ApiOperation({ summary: '내 샵 실행 기록 저장 (행동별 하루 한 번)' })
  @Post()
  @HttpCode(HttpStatus.OK)
  record(@CurrentUser() user: User, @Body() dto: RecordGrowthNoteDto) {
    return this.service.record(user.id, dto);
  }

  @ApiOperation({ summary: '본인의 실행 기록 삭제' })
  @Delete(':id')
  remove(
    @CurrentUser() user: User,
    @Query() target: GrowthNoteTargetDto,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.remove(user.id, target, id);
  }
}
