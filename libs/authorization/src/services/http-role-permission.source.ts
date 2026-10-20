import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseSnapshot, RolePermissionSource, SnapshotFetch } from './role-permission-source';

/** 30초 주기 확인이 느린 응답에 쌓이지 않게 끊는다. */
const FETCH_TIMEOUT_MS = 5_000;

/** user-service 의 내부 경로에서 역할별 권한을 받는다. */
@Injectable()
export class HttpRolePermissionSource extends RolePermissionSource {
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

  async fetch(knownVersion: string | null): Promise<SnapshotFetch> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.key ?? ''}` };
    if (knownVersion) headers['if-none-match'] = `"${knownVersion}"`;
    const response = await fetch(`${this.baseUrl}/internal/iam/role-permissions`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status === 304) return { status: 'not_modified' };
    if (!response.ok) throw new Error(`role-permissions responded ${response.status}`);
    const body: unknown = await response.json();
    return { status: 'loaded', snapshot: parseSnapshot(body) };
  }
}
