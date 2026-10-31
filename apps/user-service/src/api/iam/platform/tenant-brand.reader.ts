import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { PlatformRepository } from './platform.repository';

export interface TenantBrand {
  readonly displayName: string;
  readonly logoUrl: string | null;
  readonly active: boolean;
}

/**
 * 주소 → 테넌트 → 브랜드. auth-web·admin-web 이 로그인 전에(토큰 없이) 부른다 — 그래서 이름·로고·활성 여부 밖의 것(id·slug·
 * 다른 도메인·상태 이름)은 돌려주지 않는다. 모르는 주소는 404.
 */
@Injectable()
export class TenantBrandReader {
  constructor(private readonly platform: PlatformRepository) {}

  async byHost(host: string): Promise<TenantBrand> {
    const row = await this.platform.findBrandByHost(host.toLowerCase());
    if (!row) throw new NotFoundError('알 수 없는 주소입니다.');
    return { displayName: row.displayName, logoUrl: row.logoUrl, active: row.status === 'active' };
  }
}
