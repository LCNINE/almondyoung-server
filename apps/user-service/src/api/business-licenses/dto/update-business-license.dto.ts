import { PartialType } from '@nestjs/swagger';
import { BusinessLicenseBaseDto } from './create-business-license.dto';

export class UpdateBusinessLicenseDto extends PartialType(
  BusinessLicenseBaseDto,
) {}
