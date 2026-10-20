import { RolePermissionSource, SnapshotFetch } from '@app/authorization';
import { Inject, Injectable } from '@nestjs/common';
import { IamService } from './iam.service';

/** user-service 는 자기 HTTP 를 부르지 않고 같은 스냅샷을 DB 에서 바로 읽는다. */
@Injectable()
export class LocalRolePermissionSource extends RolePermissionSource {
  constructor(@Inject(IamService) private readonly iam: Pick<IamService, 'roleSnapshot'>) {
    super();
  }

  isConfigured(): boolean {
    return true;
  }

  async fetch(knownVersion: string | null): Promise<SnapshotFetch> {
    const snapshot = await this.iam.roleSnapshot();
    if (snapshot.version === knownVersion) return { status: 'not_modified' };
    return {
      status: 'loaded',
      snapshot: { version: snapshot.version, roles: new Map(Object.entries(snapshot.roles)) },
    };
  }
}
