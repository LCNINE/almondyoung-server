import { Module } from '@nestjs/common';
import { RoleAssignmentController } from './assignments/role-assignment.controller';
import { RoleAssignmentManager } from './assignments/role-assignment.manager';
import { RoleAssignmentReader } from './assignments/role-assignment.reader';
import { RoleAssignmentService } from './assignments/role-assignment.service';
import { IamAuditController } from './audit/iam-audit.controller';
import { IamAuditCreator } from './audit/iam-audit.creator';
import { IamAuditReader } from './audit/iam-audit.reader';
import { IamAuditService } from './audit/iam-audit.service';
import { IamAuditRepository } from './audit/iam-audit.repository';
import { IamInternalController } from './iam-internal.controller';
import { IamRepository } from './iam.repository';
import { IamService } from './iam.service';
import { MePermissionsController } from './me-permissions.controller';
import { MyPermissionsReader } from './my-permissions.reader';
import { PermissionCatalogSyncBootstrap } from './permission-catalog-sync.bootstrap';
import { PermissionCatalogSyncManager } from './permission-catalog-sync.manager';
import { RolePermissionsReader } from './role-permissions.reader';
import { RoleAdminController } from './roles/role-admin.controller';
import { RoleAdminManager } from './roles/role-admin.manager';
import { RoleAdminReader } from './roles/role-admin.reader';
import { RoleAdminService } from './roles/role-admin.service';
import { RoleRepository } from './roles/role.repository';

@Module({
  controllers: [
    IamInternalController,
    MePermissionsController,
    RoleAdminController,
    RoleAssignmentController,
    IamAuditController,
  ],
  providers: [
    IamRepository,
    PermissionCatalogSyncManager,
    PermissionCatalogSyncBootstrap,
    RolePermissionsReader,
    MyPermissionsReader,
    IamService,
    IamAuditRepository,
    IamAuditCreator,
    IamAuditReader,
    IamAuditService,
    RoleRepository,
    RoleAdminReader,
    RoleAdminManager,
    RoleAdminService,
    RoleAssignmentReader,
    RoleAssignmentManager,
    RoleAssignmentService,
  ],
  exports: [IamService, RoleAssignmentManager],
})
export class IamModule {}
