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
import { PiiAccessLogController } from './pii-access/pii-access-log.controller';
import { PiiAccessRecordController } from './pii-access/pii-access-record.controller';
import { PiiAccessRetentionCron } from './pii-access/pii-access-retention.cron';
import { PiiAccessConsumer } from './pii-access/pii-access.consumer';
import { PiiAccessCreator } from './pii-access/pii-access.creator';
import { PiiAccessManager } from './pii-access/pii-access.manager';
import { PiiAccessReader } from './pii-access/pii-access.reader';
import { PiiAccessRepository } from './pii-access/pii-access.repository';
import { PiiAccessService } from './pii-access/pii-access.service';
import { PermissionCatalogSyncBootstrap } from './permission-catalog-sync.bootstrap';
import { PermissionCatalogSyncManager } from './permission-catalog-sync.manager';
import { RolePermissionsReader } from './role-permissions.reader';
import { RoleAdminController } from './roles/role-admin.controller';
import { RoleAdminManager } from './roles/role-admin.manager';
import { RoleAdminReader } from './roles/role-admin.reader';
import { RoleAdminService } from './roles/role-admin.service';
import { RoleRepository } from './roles/role.repository';
import { ActorTenantReader } from './tenancy/actor-tenant.reader';
import { PlatformOperatorManager } from './tenancy/platform-operator.manager';
import { TenancyRepository } from './tenancy/tenancy.repository';

@Module({
  controllers: [
    IamInternalController,
    MePermissionsController,
    RoleAdminController,
    RoleAssignmentController,
    IamAuditController,
    PiiAccessLogController,
    PiiAccessRecordController,
    PiiAccessConsumer,
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
    TenancyRepository,
    ActorTenantReader,
    PlatformOperatorManager,
    RoleAdminReader,
    RoleAdminManager,
    RoleAdminService,
    RoleAssignmentReader,
    RoleAssignmentManager,
    RoleAssignmentService,
    PiiAccessRepository,
    PiiAccessCreator,
    PiiAccessReader,
    PiiAccessManager,
    PiiAccessService,
    PiiAccessRetentionCron,
  ],
  exports: [IamService, RoleAssignmentManager, PlatformOperatorManager, PiiAccessCreator],
})
export class IamModule {}
