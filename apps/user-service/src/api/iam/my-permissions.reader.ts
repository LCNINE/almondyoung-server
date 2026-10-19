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
    // 역할 집합만으로 정한다(사람별 순서를 쓰지 않는다) — 같은 역할 조합이면 응답이 같아야 화면 서버가 캐시한다.
    const landing = rows
      .filter((row) => row.landingPath)
      .sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      )[0];
    return {
      roles: rows.map((row) => ({ name: row.name, displayName: row.displayName ?? row.name })),
      permissions,
      version: snapshot.version,
      landingPath: landing?.landingPath ?? null,
    };
  }
}
