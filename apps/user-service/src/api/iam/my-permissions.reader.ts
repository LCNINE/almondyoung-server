import { Injectable } from '@nestjs/common';
import { MyPermissionsResponseDto } from './dto/my-permissions.dto';
import { IamRepository } from './iam.repository';
import { RolePermissionsReader } from './role-permissions.reader';

@Injectable()
export class MyPermissionsReader {
  constructor(
    private readonly rolePermissions: RolePermissionsReader,
    private readonly repository: IamRepository,
  ) {}

  async forRoles(roleNames: string[]): Promise<MyPermissionsResponseDto> {
    const [snapshot, rows] = await Promise.all([
      this.rolePermissions.snapshot(),
      this.repository.findRolesByNames(roleNames),
    ]);
    // 역할 이름은 토큰에서 온 문자열이라 상속 속성(`constructor` 등)과 겹칠 수 있다 — 자기 키만 본다.
    const ownGrants = (name: string) => (Object.hasOwn(snapshot.roles, name) ? snapshot.roles[name] : []);
    const permissions = [...new Set(roleNames.flatMap(ownGrants))].sort();
    return {
      roles: rows.map((row) => ({ name: row.name, displayName: row.displayName ?? row.name })),
      permissions,
      version: snapshot.version,
    };
  }
}
