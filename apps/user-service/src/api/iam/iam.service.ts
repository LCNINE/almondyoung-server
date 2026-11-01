import { Injectable } from '@nestjs/common';
import type { MyPermissionsResponseDto } from './dto/my-permissions.dto';
import type { TenantStatusesDto } from './dto/tenant-statuses.dto';
import { MyPermissionsReader } from './my-permissions.reader';
import { PlatformTenantReader } from './platform/platform-tenant.reader';
import { RolePermissionsReader, RolePermissionsSnapshot } from './role-permissions.reader';

@Injectable()
export class IamService {
  constructor(
    private readonly rolePermissions: RolePermissionsReader,
    private readonly myPermissions: MyPermissionsReader,
    private readonly tenants: PlatformTenantReader,
  ) {}

  roleSnapshot(): Promise<RolePermissionsSnapshot> {
    return this.rolePermissions.snapshot();
  }

  forRoles(roleNames: string[]): Promise<MyPermissionsResponseDto> {
    return this.myPermissions.forRoles(roleNames);
  }

  async tenantStatuses(): Promise<TenantStatusesDto> {
    return { tenants: await this.tenants.statuses() };
  }
}
