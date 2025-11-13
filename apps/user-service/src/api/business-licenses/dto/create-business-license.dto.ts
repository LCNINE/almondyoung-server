import { PickType } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class BusinessLicenseBaseDto {
  @IsNotEmpty({ message: '증빙 검증 파일은 필수입니다.' })
  @IsString({ message: '증빙 검증 파일은 문자열이어야 합니다.' })
  file: string;

  @IsOptional({ message: '상점ID는 선택사항입니다.' })
  @IsUUID('4', { message: '상점ID는 UUID 형식이어야 합니다.' })
  shopId?: string;

  @IsNotEmpty({ message: '사업자번호는 필수입니다.' })
  @Length(10, 10)
  businessNumber: string;

  @IsNotEmpty({ message: '대표자명은 필수입니다.' })
  @Length(1, 100)
  representativeName: string;

  @IsOptional({ message: '메타데이터는 선택사항입니다.' })
  metadata?: string;
}

// 파일 업로드용 dto
export class CreateBusinessLicenseWithFileDto extends PickType(
  BusinessLicenseBaseDto,
  ['file', 'shopId', 'metadata'] as const,
) {}
