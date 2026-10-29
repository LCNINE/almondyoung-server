import { Module } from '@nestjs/common';
import { BusinessLicensesController } from './business-licenses.controller';
import { BusinessLicensesService } from './business-licenses.service';
import { UserRolesReader } from '../../users/user-roles.reader';
import { UsersService } from '../../users/users.service';

@Module({
  imports: [],
  controllers: [BusinessLicensesController],
  providers: [BusinessLicensesService, UsersService, UserRolesReader],
  exports: [BusinessLicensesService],
})
export class AdminBusinessLicensesModule {}
