import { Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { InternalFilesService } from './internal-files.service';
import { RequestTenant, type RequestTenantId } from '../tenancy/request-tenant';

/**
 * 서비스 간 호출 전용 파일 정리 라우트. 사람 JWT 가 없는 호출자(ai 앱의 고아 파일
 * 수거 크론)가 공유 키로 부른다.
 *
 * 사용자용 `LifecycleController` 와 파일을 나눈 것은 의도다 — 한 컨트롤러에 두 인증
 * 체제를 섞으면 핸들러를 더하는 사람이 어느 규칙인지 헷갈린다.
 *
 * 키는 테넌트를 말하지 못하므로 테넌트는 호출자의 테넌트 헤더다(`FileRequestTenantInterceptor`). 그 테넌트의 파일만 보인다.
 */
@ApiExcludeController()
@InternalOnly()
@Controller('internal/files')
export class InternalFilesController {
  constructor(private readonly service: InternalFilesService) {}

  @Get(':fileId')
  async describe(@Param('fileId', ParseUUIDPipe) fileId: string, @RequestTenant() tenant: RequestTenantId) {
    return this.service.describe(fileId, tenant);
  }

  @Get(':fileId/attendance-evidence')
  attendanceEvidence(@Param('fileId', ParseUUIDPipe) fileId: string, @RequestTenant() tenant: RequestTenantId) {
    return this.service.attendanceEvidence(fileId, tenant);
  }

  @Delete(':fileId')
  async softDelete(@Param('fileId', ParseUUIDPipe) fileId: string, @RequestTenant() tenant: RequestTenantId) {
    return this.service.softDelete(fileId, tenant);
  }

  @Delete(':fileId/object')
  async purgeObject(@Param('fileId', ParseUUIDPipe) fileId: string, @RequestTenant() tenant: RequestTenantId) {
    return this.service.purgeObject(fileId, tenant);
  }

  @Post(':fileId/restore')
  async restore(@Param('fileId', ParseUUIDPipe) fileId: string, @RequestTenant() tenant: RequestTenantId) {
    return this.service.restore(fileId, tenant);
  }
}
