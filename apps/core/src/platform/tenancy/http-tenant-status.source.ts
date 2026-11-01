import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TENANT_STATUSES, TenantStatusSource, type TenantStatus } from './tenant-status-cache';

/** 주기 확인이 느린 응답에 쌓이지 않게 끊는다. */
const FETCH_TIMEOUT_MS = 5_000;

const STATUSES: ReadonlySet<string> = new Set(TENANT_STATUSES);

function isStatus(value: unknown): value is TenantStatus {
  return typeof value === 'string' && STATUSES.has(value);
}

/** `JSON.parse` 결과의 자기 속성 하나. 객체가 아니거나 없으면 undefined. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Object.entries(value).find(([name]) => name === key)?.[1];
}

/** 본문을 통째로 검사한다 — 틀린 항목 하나면 사본 전체를 버리고 마지막 사본을 쓴다. */
function parseStatuses(body: unknown): ReadonlyMap<string, TenantStatus> {
  const tenants = field(body, 'tenants');
  if (!Array.isArray(tenants)) throw new Error('tenant-statuses body is malformed');
  const statuses = new Map<string, TenantStatus>();
  for (const entry of tenants) {
    const id = field(entry, 'id');
    const status = field(entry, 'status');
    if (typeof id !== 'string' || !isStatus(status)) throw new Error('tenant-statuses body is malformed');
    statuses.set(id, status);
  }
  return statuses;
}

/** user-service 내부 경로에서 테넌트 상태를 받는다. 권한 사본과 같은 키·주소를 쓴다. */
@Injectable()
export class HttpTenantStatusSource extends TenantStatusSource {
  private readonly baseUrl: string | undefined;
  private readonly key: string | undefined;

  constructor(config: ConfigService) {
    super();
    this.baseUrl = config.get<string>('USER_SERVICE_URL')?.replace(/\/+$/, '');
    this.key = config.get<string>('USER_SERVICE_INTERNAL_KEY');
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.key);
  }

  async fetch(): Promise<ReadonlyMap<string, TenantStatus>> {
    const response = await fetch(`${this.baseUrl}/internal/iam/tenant-statuses`, {
      headers: { authorization: `Bearer ${this.key ?? ''}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`tenant-statuses responded ${response.status}`);
    return parseStatuses(await response.json());
  }
}
