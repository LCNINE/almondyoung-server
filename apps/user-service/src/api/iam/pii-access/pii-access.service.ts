import { Injectable } from '@nestjs/common';
import type { IamActor } from '../iam-actor';
import type {
  CreatePiiAccessReviewDto,
  PiiAccessLogsQueryDto,
  PiiAccessPageDto,
  PiiAccessReviewDto,
  PiiAccessSummaryDto,
  PiiAccessSummaryQueryDto,
} from './dto/pii-access.dto';
import { PiiAccessCreator, type StoredPiiAccess } from './pii-access.creator';
import { PiiAccessManager } from './pii-access.manager';
import { PiiAccessReader } from './pii-access.reader';

@Injectable()
export class PiiAccessService {
  constructor(
    private readonly manager: PiiAccessManager,
    private readonly reader: PiiAccessReader,
    private readonly creator: PiiAccessCreator,
  ) {}

  page(actor: IamActor, query: PiiAccessLogsQueryDto): Promise<PiiAccessPageDto> {
    return this.manager.viewLogs(actor, query);
  }

  summary(query: PiiAccessSummaryQueryDto): Promise<PiiAccessSummaryDto> {
    return this.reader.summary(query);
  }

  reviews(): Promise<PiiAccessReviewDto[]> {
    return this.reader.reviews();
  }

  createReview(actor: IamActor, dto: CreatePiiAccessReviewDto): Promise<PiiAccessReviewDto> {
    return this.manager.createReview(actor, dto);
  }

  record(entry: StoredPiiAccess): Promise<void> {
    return this.creator.record(entry);
  }

  recordOwn(actor: IamActor, entry: StoredPiiAccess): Promise<void> {
    return this.manager.recordOwn(actor, entry);
  }
}
