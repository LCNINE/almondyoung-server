import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PermissionCatalogSyncManager } from './permission-catalog-sync.manager';

/**
 * 부팅 때 권한 목록을 DB 에 맞춘다.
 *
 * 실패해도 부팅은 계속한다 — 아직 이 데이터를 판정에 쓰는 곳이 없어서, 동기화 실패로
 * 로그인 서비스가 안 뜨면 새 기능 때문에 기존 기능이 죽는 셈이다. 다른 서비스가 이 데이터에
 * 의존하기 시작하면 이 정책을 다시 정한다.
 */
@Injectable()
export class PermissionCatalogSyncBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionCatalogSyncBootstrap.name);

  constructor(private readonly manager: PermissionCatalogSyncManager) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await this.manager.sync();
      this.logger.log(
        `permission catalog synced: inserted=${result.inserted.length} deprecated=${result.deprecated} restored=${result.restored} grants=${result.grants} relabeled=${result.relabeled}`,
      );
      if (result.missingRoles.length > 0) {
        this.logger.warn(`initial grants skipped for missing roles: ${result.missingRoles.join(', ')}`);
      }
    } catch (error) {
      this.logger.error('permission catalog sync failed — continuing boot', error);
    }
  }
}
