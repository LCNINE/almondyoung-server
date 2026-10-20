import { PiiAccessRecorder, type PiiAccessRecord } from '@app/authorization';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TIMEOUT_MS = 2_000;

/**
 * notification 은 아웃박스가 없어 user-service 기록 API 를 동기로 부른다.
 * 실패하면 throw — 인터셉터가 원문 대신 가린 값을 돌려준다.
 */
@Injectable()
export class HttpPiiAccessRecorder extends PiiAccessRecorder {
  constructor(@Inject(ConfigService) private readonly config: Pick<ConfigService, 'get'>) {
    super();
  }

  async record(entry: PiiAccessRecord): Promise<void> {
    const baseUrl = this.config.get<string>('USER_SERVICE_URL');
    const key = this.config.get<string>('USER_SERVICE_INTERNAL_KEY');
    if (!baseUrl || !key) throw new Error('pii access log endpoint is not configured');
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/internal/iam/pii-access-logs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...entry, occurredAt: entry.occurredAt.toISOString() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`pii access log endpoint answered ${response.status}`);
  }
}
