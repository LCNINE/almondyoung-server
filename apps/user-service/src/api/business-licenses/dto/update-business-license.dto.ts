import { PartialType } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import * as schema from '../../../../database/drizzle/schema';
import { statusEnum } from '../../../../database/drizzle/schema';
import { BusinessLicenseBaseDto } from './create-business-license.dto';

export class UpdateBusinessLicenseDto extends PartialType(
  BusinessLicenseBaseDto,
) {}

export class UpdateBusinessLicenseDtoWithReviewCommentAndStatus extends PartialType(
  BusinessLicenseBaseDto,
) {
  @IsString({ message: '검토 코멘트는 문자열이어야 합니다.' })
  @IsOptional({ message: '검토 코멘트는 선택사항입니다.' })
  reviewCommen?: string;

  @IsIn(statusEnum.enumValues, { each: true })
  @IsString({ message: '상태는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '해당 사업자 등록 정보의 상태값을 설정해주세요.' })
  status: (typeof schema.statusEnum.enumValues)[number];
}
