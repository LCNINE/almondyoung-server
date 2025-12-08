import { Module } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { BusinessLicensesController } from './business-licenses.controller';
import { BusinessLicensesService } from './business-licenses.service';

@Module({
  imports: [UsersService],
  controllers: [BusinessLicensesController],
  providers: [BusinessLicensesService],
  exports: [BusinessLicensesService],
})
export class AdminBusinessLicensesModule { }
