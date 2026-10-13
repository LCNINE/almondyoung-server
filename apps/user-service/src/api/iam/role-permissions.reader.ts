import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { CUSTOMER_ROLE_NAMES, SYSTEM_ROLE_NAME } from './iam.constants';
import { IamRepository } from './iam.repository';

export interface RolePermissionsSnapshot {
  /** 내용에서 계산한 값. 역할 이름·매핑이 어떤 경로로 바뀌든(기존 역할 API, 직접 SQL 포함) 따라 바뀐다. */
  version: string;
  roles: Record<string, string[]>;
}

@Injectable()
export class RolePermissionsReader {
  constructor(private readonly repository: IamRepository) {}

  async snapshot(): Promise<RolePermissionsSnapshot> {
    const [active, rows] = await Promise.all([
      this.repository.findActivePermissionKeys(),
      this.repository.findStaffGrants(CUSTOMER_ROLE_NAMES),
    ]);

    // 역할 이름은 사람이 정하므로 객체 리터럴 키로 쓰지 않는다(`constructor` 같은 이름이 상속 속성과 겹친다).
    const byRole = new Map<string, string[]>();
    for (const row of rows) {
      const keys = byRole.get(row.roleName) ?? [];
      if (row.permissionKey) keys.push(row.permissionKey);
      byRole.set(row.roleName, keys);
    }
    byRole.set(SYSTEM_ROLE_NAME, [...active]);

    const entries = [...byRole.entries()]
      .map(([name, keys]): [string, string[]] => [name, [...keys].sort()])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return {
      version: createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16),
      roles: Object.fromEntries(entries),
    };
  }
}
