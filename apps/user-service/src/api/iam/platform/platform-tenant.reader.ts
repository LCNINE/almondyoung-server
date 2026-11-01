import { DbService, InjectDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import type { UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import type { TenantStatusDto } from '../dto/tenant-statuses.dto';
import type { IamActor } from '../iam-actor';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import type { TenantDto } from './dto/platform.dto';
import { PlatformRepository } from './platform.repository';

/** 테넌트 목록·상세 — 다른 테넌트의 도메인이 보이므로 조회도 운영자만 한다. 상태만은 내부 키로 다른 서비스에 준다. */
@Injectable()
export class PlatformTenantReader {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly platform: PlatformRepository,
    private readonly operators: PlatformOperatorManager,
  ) {}

  async list(actor: IamActor): Promise<TenantDto[]> {
    await this.dbService.run((tx) => this.operators.assertOperator(actor, tx));
    const [rows, domains] = await Promise.all([this.platform.listTenants(), this.platform.domainsOfAll()]);
    return rows.map((row) => ({
      ...row,
      domains: domains.filter((d) => d.tenantId === row.id).map((d) => d.host),
    }));
  }

  async get(actor: IamActor, tenantId: string): Promise<TenantDto> {
    await this.dbService.run((tx) => this.operators.assertOperator(actor, tx));
    const row = await this.platform.findTenant(tenantId);
    if (!row) throw new NotFoundError(`테넌트를 찾을 수 없습니다: ${tenantId}`);
    return { ...row, domains: await this.platform.domainsOf(tenantId) };
  }

  /** 모든 테넌트의 상태(내부 경로). 도메인이 없으니 운영자 판정 없이 내부 키 하나로 연다. */
  async statuses(): Promise<TenantStatusDto[]> {
    const rows = await this.platform.listTenants();
    return rows.map(({ id, status }) => ({ id, status }));
  }
}
