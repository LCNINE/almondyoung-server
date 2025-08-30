import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessLicensesController } from './business-licenses.controller';
import { BusinessLicensesService } from './business-licenses.service';

@Module({
  controllers: [BusinessLicensesController],
  providers: [BusinessLicensesService],
  exports: [BusinessLicensesService],
})
export class BusinessLicensesModule {}
