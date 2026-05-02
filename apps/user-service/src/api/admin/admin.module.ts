import { Module } from '@nestjs/common';
import { AdminAuthModule } from './auth/auth.module';
import { BlacklistsModule } from './blacklists/blacklists.module';
import { AdminBusinessLicensesModule } from './business-licenses/business-licenses.module';
import { AdminDormantModule } from './dormant/dormant.module';
import { AdminOAuthClientsModule } from './oauth-clients/oauth-clients.module';
import { AdminRolesModule } from './roles/roles.module';
import { AdminShopModule } from './shop/shop.modulet';
import { AdminUserModule } from './users/users.module';

@Module({
  imports: [
    AdminAuthModule,
    AdminBusinessLicensesModule,
    AdminRolesModule,
    AdminUserModule,
    AdminDormantModule,
    AdminOAuthClientsModule,
    BlacklistsModule,
    AdminShopModule,
  ],
})
export class AdminModule {}
