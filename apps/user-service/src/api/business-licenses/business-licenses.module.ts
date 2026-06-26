import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { BusinessLicensesController } from './business-licenses.controller';
import { BusinessLicensesService } from './business-licenses.service';

@Module({
  imports: [HttpModule],
  controllers: [BusinessLicensesController],
  providers: [BusinessLicensesService],
  exports: [BusinessLicensesService],
})
export class BusinessLicensesModule {}
