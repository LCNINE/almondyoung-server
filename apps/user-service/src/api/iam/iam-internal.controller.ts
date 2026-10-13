import { SkipResponseEnvelope } from '@app/shared';
import { Controller, Get, Headers, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Public } from '../../commons/decorator/public.decorator';
import { InternalApiKeyGuard } from '../../commons/guards/internal-api-key.guard';
import { RolePermissionsSnapshotDto } from './dto/role-permissions-snapshot.dto';
import { IamService } from './iam.service';

/** 이 경로가 응답 객체에서 쓰는 부분. */
export type EtagReply = {
  status(code: number): EtagReply;
  header(name: string, value: string): EtagReply;
};

/** 다른 서비스가 역할별 권한을 받아 가는 경로. 사람 토큰이 아니라 내부 키로만 연다. */
@ApiExcludeController()
@Controller('internal/iam')
export class IamInternalController {
  constructor(private readonly iamService: IamService) {}

  @Get('role-permissions')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @SkipResponseEnvelope()
  async rolePermissions(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply | EtagReply,
  ): Promise<RolePermissionsSnapshotDto | undefined> {
    const snapshot = await this.iamService.roleSnapshot();
    const etag = `"${snapshot.version}"`;
    reply.header('ETag', etag);
    if (ifNoneMatch === etag) {
      reply.status(304);
      return undefined;
    }
    return snapshot;
  }
}
