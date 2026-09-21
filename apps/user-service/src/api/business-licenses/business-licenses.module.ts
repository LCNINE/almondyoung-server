import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { BusinessLicenseAutoReviewService } from './business-license-auto-review.service';
import { BusinessLicensesController } from './business-licenses.controller';
import { BusinessLicensesService } from './business-licenses.service';
import { LicenseImageReader } from './license-image-reader';

@Module({
  imports: [HttpModule],
  controllers: [BusinessLicensesController],
  providers: [BusinessLicensesService, BusinessLicenseAutoReviewService, LicenseImageReader],
  exports: [BusinessLicensesService],
})
export class BusinessLicensesModule {}
