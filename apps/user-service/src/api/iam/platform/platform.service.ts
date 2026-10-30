import { Injectable } from '@nestjs/common';
import type { IamActor } from '../iam-actor';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import type {
  AddStaffClientUrisDto,
  CreateTenantDto,
  ReissuedPasswordDto,
  ReissuePasswordDto,
  SetTenantStatusDto,
  TenantBrandDto,
  TenantDto,
} from './dto/platform.dto';
import { PlatformTenantManager } from './platform-tenant.manager';
import { PlatformTenantReader } from './platform-tenant.reader';
import { TenantBrandReader } from './tenant-brand.reader';

@Injectable()
export class PlatformService {
  constructor(
    private readonly reader: PlatformTenantReader,
    private readonly manager: PlatformTenantManager,
    private readonly operators: PlatformOperatorManager,
    private readonly brands: TenantBrandReader,
  ) {}

  list(actor: IamActor): Promise<TenantDto[]> {
    return this.reader.list(actor);
  }

  get(actor: IamActor, tenantId: string): Promise<TenantDto> {
    return this.reader.get(actor, tenantId);
  }

  async create(actor: IamActor, dto: CreateTenantDto): Promise<TenantDto> {
    await this.manager.createTenant(actor, dto);
    return this.reader.get(actor, dto.id);
  }

  async setStatus(actor: IamActor, tenantId: string, dto: SetTenantStatusDto): Promise<TenantDto> {
    await this.manager.setStatus(actor, tenantId, dto.status);
    return this.reader.get(actor, tenantId);
  }

  delete(actor: IamActor, tenantId: string): Promise<void> {
    return this.manager.deleteTenant(actor, tenantId);
  }

  addMember(actor: IamActor, tenantId: string, userId: string): Promise<void> {
    return this.manager.addMember(actor, tenantId, userId);
  }

  addStaffClientUris(actor: IamActor, tenantId: string, clientId: string, dto: AddStaffClientUrisDto): Promise<void> {
    return this.manager.addStaffClientUris(actor, tenantId, clientId, dto);
  }

  reissuePassword(
    actor: IamActor,
    tenantId: string,
    userId: string,
    dto: ReissuePasswordDto,
  ): Promise<ReissuedPasswordDto> {
    return this.manager.reissuePassword(actor, tenantId, userId, dto.forcePasswordChange);
  }

  setOperator(actor: IamActor, userId: string, isOperator: boolean): Promise<void> {
    return this.operators.setOperator(actor, userId, isOperator);
  }

  brand(host: string): Promise<TenantBrandDto> {
    return this.brands.byHost(host);
  }
}
