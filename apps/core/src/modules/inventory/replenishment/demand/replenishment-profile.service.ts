import { Injectable } from '@nestjs/common';
import { RefreshSeries, RefreshSummary, ReplenishmentRefreshJob } from './replenishment-refresh.job';

/** 야간 배치와 같은 세 단계를 지금. 트랜잭션 경계는 단계별로 잡이 갖는다. */
@Injectable()
export class ReplenishmentProfileService {
  constructor(private readonly job: ReplenishmentRefreshJob) {}

  recompute(series: RefreshSeries): Promise<RefreshSummary> {
    return this.job.run(series);
  }
}
