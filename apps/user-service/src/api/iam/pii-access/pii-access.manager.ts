import { PermissionCache } from '@app/authorization';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, ForbiddenError } from '@app/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import type { IamActor } from '../iam-actor';
import type {
  CreatePiiAccessReviewDto,
  PiiAccessLogsQueryDto,
  PiiAccessPageDto,
  PiiAccessReviewDto,
} from './dto/pii-access.dto';
import { PiiAccessCreator, type StoredPiiAccess } from './pii-access.creator';
import { PiiAccessReader } from './pii-access.reader';
import { PiiAccessRepository } from './pii-access.repository';

@Injectable()
export class PiiAccessManager {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly reader: PiiAccessReader,
    private readonly repository: PiiAccessRepository,
    private readonly audit: IamAuditCreator,
    private readonly creator: PiiAccessCreator,
    @Inject(PermissionCache) private readonly permissions: Pick<PermissionCache, 'permissionsFor'>,
  ) {}

  /**
   * 관리자 화면 프록시가 직원 본인 토큰으로 남기는 기록. 원문을 볼 수 있는 사람만 남길 수 있다 — 강제 판정 스위치와 무관하게
   * 여기서 직접 본다(아니면 원문을 보지 않은 사람이 기록을 꾸며 넣을 수 있다).
   */
  async recordOwn(actor: IamActor, entry: StoredPiiAccess): Promise<void> {
    const held = this.permissions.permissionsFor(actor.roles);
    if (!held?.has('customer.pii.read')) throw new ForbiddenError('개인정보 보기 권한이 있어야 접속기록을 남길 수 있습니다.');
    await this.creator.record(entry);
  }

  /** 접속기록을 본 것도 남긴다(로그 열람 자체가 기록 대상). 이력을 못 남기면 조회도 실패한다. */
  viewLogs(actor: IamActor, query: PiiAccessLogsQueryDto): Promise<PiiAccessPageDto> {
    return this.dbService.run(async (tx) => {
      const page = await this.reader.page(query);
      await this.audit.record(tx, actor, {
        action: 'pii_access_log.view',
        targetType: 'pii_access_log',
        targetId: actor.userId,
        targetLabel: '개인정보 접속기록 조회',
        before: null,
        after: { filter: query, returned: page.items.length },
      });
      return page;
    });
  }

  async createReview(actor: IamActor, dto: CreatePiiAccessReviewDto): Promise<PiiAccessReviewDto> {
    const rangeFrom = new Date(dto.rangeFrom);
    const rangeTo = new Date(dto.rangeTo);
    if (!(rangeFrom.getTime() < rangeTo.getTime())) throw new BadRequestError('점검 기간의 끝이 시작보다 뒤여야 합니다.');
    return this.repository.insertReview({
      period: dto.period,
      rangeFrom,
      rangeTo,
      reviewedBy: actor.userId,
      reviewedByLoginId: actor.loginId?.slice(0, 30) ?? null,
      note: dto.note?.trim() ? dto.note.trim() : null,
    });
  }
}
