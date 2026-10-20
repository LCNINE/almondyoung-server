import { RequirePermission } from '@app/authorization';
import { SkipResponseEnvelope } from '@app/shared';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../../commons/decorator/public.decorator';
import { InternalApiKeyGuard } from '../../../commons/guards/internal-api-key.guard';
import { CurrentIamActor, type IamActor } from '../iam-actor';
import { InternalPiiAccessRecordDto, OwnPiiAccessRecordDto } from './dto/pii-access.dto';
import { PiiAccessService } from './pii-access.service';

/** 개인정보 원문을 직원에게 넘긴 쪽이 접속기록을 동기로 남기는 경로(아웃박스가 없는 곳만). */
@Controller()
export class PiiAccessRecordController {
  constructor(private readonly service: PiiAccessService) {}

  // 관리자 화면 프록시(Medusa 응답) — 직원 본인 토큰으로 부른다. 행위자는 토큰이 정하고 본문은 정하지 못한다.
  // 옛 스코프 표식은 달지 않는다 — 권한 키로만 구성한 역할도 남길 수 있어야 하고, 권한은 Manager 가 직접 본다.
  @ApiExcludeEndpoint()
  @RequirePermission('customer.pii.read')
  @Post('iam/pii-access-logs')
  @HttpCode(204)
  recordOwn(@CurrentIamActor() actor: IamActor, @Body() body: OwnPiiAccessRecordDto): Promise<void> {
    return this.service.recordOwn(actor, {
      eventId: body.eventId,
      actorUserId: actor.userId,
      actorLoginId: actor.loginId,
      claimedIp: body.claimedIp ?? null,
      peerIp: body.peerIp ?? null,
      forwardedFor: body.forwardedFor ?? null,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      sourceService: body.sourceService,
      method: body.method,
      route: body.route,
      action: body.action,
      subjects: body.subjects,
      subjectCount: body.subjectCount,
      kinds: body.kinds,
      queryKeys: body.queryKeys,
      reason: body.reason ?? null,
      occurredAt: new Date(body.occurredAt),
    });
  }

  @ApiExcludeEndpoint()
  @Post('internal/iam/pii-access-logs')
  @HttpCode(204)
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @SkipResponseEnvelope()
  recordInternal(@Body() body: InternalPiiAccessRecordDto): Promise<void> {
    return this.service.record({
      eventId: body.eventId,
      actorUserId: body.actorUserId,
      actorLoginId: body.actorLoginId ?? null,
      claimedIp: body.claimedIp ?? null,
      peerIp: body.peerIp ?? null,
      forwardedFor: body.forwardedFor ?? null,
      userAgent: body.userAgent ?? null,
      requestId: body.requestId ?? null,
      sourceService: body.sourceService,
      method: body.method,
      route: body.route,
      action: body.action,
      subjects: body.subjects,
      subjectCount: body.subjectCount,
      kinds: body.kinds,
      queryKeys: body.queryKeys,
      reason: body.reason ?? null,
      occurredAt: new Date(body.occurredAt),
    });
  }
}
