import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { PlatformRepository } from './platform.repository';

export interface TenantBrand {
  readonly displayName: string;
  readonly logoUrl: string | null;
  readonly active: boolean;
}

/** auth-web 서버만(내부 secret) 받는 꼴 — 그 테넌트의 도메인 전부가 들어 있어 리디렉트를 그 안에 가둔다. */
export interface TenantSite extends TenantBrand {
  readonly tenantId: string;
  readonly hosts: string[];
}

/**
 * admin-web 서버만(직원 웹 클라이언트 자격, `StaffWebClientGuard`) 받는 꼴 — admin-web 주소일 때만 답한다. 테넌트 셸이 토큰 테넌트를 이 테넌트와 대조하고, 로그인을
 * `authHost`(그 테넌트의 auth-web 주소)로 보낸다. 다른 앱의 주소는 이 조회에서 «모르는 주소»다.
 */
export interface TenantAdminSite extends TenantBrand {
  readonly tenantId: string;
  /** 그 테넌트의 auth-web 주소(둘 이상이면 이름순 첫째). 없으면 null — 셸이 로그인을 보낼 곳이 없다. */
  readonly authHost: string | null;
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

  async siteByHost(host: string): Promise<TenantSite> {
    const row = await this.platform.findBrandByHost(host.toLowerCase());
    if (!row) throw new NotFoundError('알 수 없는 주소입니다.');
    return {
      tenantId: row.tenantId,
      displayName: row.displayName,
      logoUrl: row.logoUrl,
      active: row.status === 'active',
      hosts: await this.platform.domainsOf(row.tenantId),
    };
  }

  async adminSiteByHost(host: string): Promise<TenantAdminSite> {
    const row = await this.platform.findBrandByHost(host.toLowerCase());
    if (!row || row.app !== 'admin-web') throw new NotFoundError('알 수 없는 주소입니다.');
    const domains = await this.platform.domainEntriesOf(row.tenantId);
    return {
      tenantId: row.tenantId,
      displayName: row.displayName,
      logoUrl: row.logoUrl,
      active: row.status === 'active',
      authHost: domains.find((d) => d.app === 'auth-web')?.host ?? null,
    };
  }
}
