import { PartialType } from '@nestjs/swagger';
import { CreateBusinessLicenseDto } from './create-business-license.dto';

export class UpdateBusinessLicenseDto extends PartialType(
  CreateBusinessLicenseDto,
) {}
