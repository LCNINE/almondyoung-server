import { Module } from '@nestjs/common';
import { IamInternalController } from './iam-internal.controller';
import { IamRepository } from './iam.repository';
import { IamService } from './iam.service';
import { MePermissionsController } from './me-permissions.controller';
import { MyPermissionsReader } from './my-permissions.reader';
import { PermissionCatalogSyncBootstrap } from './permission-catalog-sync.bootstrap';
import { PermissionCatalogSyncManager } from './permission-catalog-sync.manager';
import { RolePermissionsReader } from './role-permissions.reader';

@Module({
  controllers: [IamInternalController, MePermissionsController],
  providers: [
    IamRepository,
    PermissionCatalogSyncManager,
    PermissionCatalogSyncBootstrap,
    RolePermissionsReader,
    MyPermissionsReader,
    IamService,
  ],
})
export class IamModule {}
