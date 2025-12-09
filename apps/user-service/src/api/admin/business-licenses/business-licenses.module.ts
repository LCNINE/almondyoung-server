import { Module } from '@nestjs/common';
import { BusinessLicensesController } from './business-licenses.controller';
import { BusinessLicensesService } from './business-licenses.service';
import { UsersService } from '../../users/users.service';

@Module({
  imports: [],
  controllers: [BusinessLicensesController],
  providers: [BusinessLicensesService, UsersService],
  exports: [BusinessLicensesService],
})
export class AdminBusinessLicensesModule { }
