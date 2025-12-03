import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateIf
} from 'class-validator';

// 사업자 생성 dto
export class CreateBusinessLicenseDto {
  @ValidateIf((o) => !o.fileUrl) // fileUrl이 없으면 필수
  @IsNotEmpty({ message: '사업자번호는 필수입니다.' })
  @Length(10, 10, { message: '사업자번호는 10자리여야 합니다.' })
  @Transform(({ value }) => value?.replace(/-/g, ''))
  businessNumber?: string;

  @ValidateIf((o) => !o.fileUrl) // fileUrl이 없으면 필수
  @IsNotEmpty({ message: '대표자명은 필수입니다.' })
  @Length(1, 20)
  representativeName?: string;

  @IsOptional()
  @IsString({ message: '증빙 검증 파일 URL은 문자열이어야 합니다.' })
  fileUrl?: string | null;
}

// 사업자 수정 dto
export class UpdateBusinessLicenseDto {
  @ValidateIf((o) => !o.fileUrl) // fileUrl이 없으면 필수
  @IsNotEmpty({ message: '사업자번호는 필수입니다.' })
  @Length(10, 10, { message: '사업자번호는 10자리여야 합니다.' })
  @Transform(({ value }) => value?.replace(/-/g, ''))
  businessNumber?: string;

  @ValidateIf((o) => !o.fileUrl) // fileUrl이 없으면 필수
  @IsNotEmpty({ message: '대표자명은 필수입니다.' })
  @Length(1, 20)
  representativeName?: string;

  @IsOptional()
  @IsString({ message: '증빙 검증 파일 URL은 문자열이어야 합니다.' })
  fileUrl?: string | null;

  @IsOptional()
  @IsBoolean({ message: '외부 사업자 상태는 불리언이어야 합니다.' })
  externalBusinessStatus?: boolean;
}

// 사업자 정보 외부 조회용 dto
export class FetchBusinessLicenseDto {
  @Transform(({ value }) => value?.replace(/-/g, ''))
  @IsNotEmpty({ message: '사업자번호는 필수입니다.' })
  @Length(10, 10, { message: '사업자번호는 10자리이어야 합니다.' })
  @IsString({ message: '사업자번호는 문자열이어야 합니다.' })
  businessNumber: string;

  @IsNotEmpty({ message: '대표자명은 필수입니다.' })
  @Length(1, 100)
  representativeName: string;
}
