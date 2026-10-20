import { Injectable } from '@nestjs/common';
import type { MyPermissionsResponseDto } from './dto/my-permissions.dto';
import { MyPermissionsReader } from './my-permissions.reader';
import { RolePermissionsReader, RolePermissionsSnapshot } from './role-permissions.reader';

@Injectable()
export class IamService {
  constructor(
    private readonly rolePermissions: RolePermissionsReader,
    private readonly myPermissions: MyPermissionsReader,
  ) {}

  roleSnapshot(): Promise<RolePermissionsSnapshot> {
    return this.rolePermissions.snapshot();
  }

  forRoles(roleNames: string[]): Promise<MyPermissionsResponseDto> {
    return this.myPermissions.forRoles(roleNames);
  }
}
