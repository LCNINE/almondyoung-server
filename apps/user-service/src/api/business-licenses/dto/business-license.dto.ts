import { Transform } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

/**
 * 국세청 상태조회 결과. 등록을 막는 용도가 아니라 metadata 에 보관해 추후 활용/UI 대응용으로 쓴다.
 * - active/suspended/closed: 번호가 실존(계속/휴업/폐업)으로 확인됨
 * - not_found: 국세청에 등록되지 않은 번호
 * - lookup_failed: API 호출 자체가 실패(키 미설정/장애/일시정지 등)
 */
export interface NtsLookupResult {
  result: 'active' | 'suspended' | 'closed' | 'not_found' | 'lookup_failed';
  checkedAt: string;
  raw?: Record<string, unknown>;
  error?: string;
}

export interface BusinessMetadata {
  nts?: NtsLookupResult;
  [key: string]: unknown;
}

// 사업자 생성 dto
export class CreateBusinessLicenseDto {
  @ValidateIf((o) => !o.fileUrl) // fileUrl이 없으면 필수
  @IsNotEmpty({ message: '사업자번호는 필수입니다.' })
  @Length(10, 10, { message: '사업자번호는 10자리여야 합니다.' })
  @Transform(({ value }) => value?.replace(/-/g, ''))
  businessNumber?: string;

  @ValidateIf((o) => !o.fileUrl) // fileUrl이 없으면 필수
  @IsNotEmpty({ message: '대표자명은 필수입니다.' })
  @Length(1, 20, { message: '대표자명은 1자 이상 20자 이하여야 합니다.' })
  representativeName?: string;

  @IsOptional()
  @IsString({ message: '증빙 검증 파일 URL은 문자열이어야 합니다.' })
  fileUrl?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: BusinessMetadata;
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
  @Length(1, 20, { message: '대표자명은 1자 이상 20자 이하여야 합니다.' })
  representativeName?: string;

  @IsOptional()
  @IsString({ message: '증빙 검증 파일 URL은 문자열이어야 합니다.' })
  fileUrl?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: BusinessMetadata;
}

// 내 사업자번호 채우기용 dto
export class FillBusinessNumberDto {
  @Transform(({ value }) => value?.replace(/-/g, ''))
  @IsNotEmpty({ message: '사업자번호는 필수입니다.' })
  @Length(10, 10, { message: '사업자번호는 10자리여야 합니다.' })
  @IsString({ message: '사업자번호는 문자열이어야 합니다.' })
  businessNumber: string;
}

// 사업자 정보 외부 조회용 dto (상태조회는 사업자번호만 필요)
export class FetchBusinessLicenseDto {
  @Transform(({ value }) => value?.replace(/-/g, ''))
  @IsNotEmpty({ message: '사업자번호는 필수입니다.' })
  @Length(10, 10, { message: '사업자번호는 10자리이어야 합니다.' })
  @IsString({ message: '사업자번호는 문자열이어야 합니다.' })
  businessNumber: string;
}
