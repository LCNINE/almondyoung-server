import { Module } from '@nestjs/common';
import { UploadModule } from 'apps/file-service/src/upload/upload.module';
import { BusinessLicensesController } from './business-licenses.controller';
import { BusinessLicensesService } from './business-licenses.service';

@Module({
  imports: [UploadModule],
  controllers: [BusinessLicensesController],
  providers: [BusinessLicensesService],
  exports: [BusinessLicensesService],
})
export class AdminBusinessLicensesModule { }
