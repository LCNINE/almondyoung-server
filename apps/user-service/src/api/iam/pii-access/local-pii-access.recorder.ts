import { PiiAccessRecorder, type PiiAccessRecord } from '@app/authorization';
import { Injectable } from '@nestjs/common';
import { PiiAccessCreator } from './pii-access.creator';

/** user-service 자신의 개인정보 응답 — 같은 DB 라 바로 쓴다. */
@Injectable()
export class LocalPiiAccessRecorder extends PiiAccessRecorder {
  constructor(private readonly creator: PiiAccessCreator) {
    super();
  }

  record(entry: PiiAccessRecord): Promise<void> {
    return this.creator.record(entry);
  }
}
