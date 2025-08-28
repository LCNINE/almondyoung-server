import { Module } from '@nestjs/common';
import { BusinessLicensesController } from './business-licenses.controller';
import { BusinessLicensesService } from './business-licenses.service';

@Module({
  controllers: [BusinessLicensesController],
  providers: [BusinessLicensesService],
  exports: [BusinessLicensesService],
})
export class BusinessLicensesModule {}
