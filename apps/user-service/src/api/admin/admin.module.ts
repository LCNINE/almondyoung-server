import { Module } from '@nestjs/common';
import { AdminAuthModule } from './auth/auth.module';
import { AdminBusinessLicensesModule } from './business-licenses/business-licenses.module';
import { AdminDormantModule } from './dormant/dormant.module';
import { AdminRolesModule } from './roles/roles.module';
import { AdminUserModule } from './users/user.module';

@Module({
  imports: [
    AdminAuthModule,
    AdminBusinessLicensesModule,
    AdminRolesModule,
    AdminUserModule,
    AdminUserModule,
    AdminDormantModule,
  ],
})
export class AdminModule {}
