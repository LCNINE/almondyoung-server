import { Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { InternalFilesService } from './internal-files.service';

/**
 * 서비스 간 호출 전용 파일 정리 라우트. 사람 JWT 가 없는 호출자(ai 앱의 고아 파일
 * 수거 크론)가 공유 키로 부른다.
 *
 * 사용자용 `LifecycleController` 와 파일을 나눈 것은 의도다 — 한 컨트롤러에 두 인증
 * 체제를 섞으면 핸들러를 더하는 사람이 어느 규칙인지 헷갈린다.
 */
@ApiExcludeController()
@InternalOnly()
@Controller('internal/files')
export class InternalFilesController {
  constructor(private readonly service: InternalFilesService) {}

  @Delete(':fileId')
  async softDelete(@Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.service.softDelete(fileId);
  }

  @Delete(':fileId/object')
  async purgeObject(@Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.service.purgeObject(fileId);
  }

  @Post(':fileId/restore')
  async restore(@Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.service.restore(fileId);
  }
}
