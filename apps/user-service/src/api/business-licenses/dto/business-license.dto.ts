import { Transform } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';

/**
 * 국세청 상태조회 결과. 번호가 실존하는지/영업 중인지만 알려준다 — 대표자명은 보지 않는다.
 * - active/suspended/closed: 번호가 실존(계속/휴업/폐업)으로 확인됨
 * - not_found: 국세청에 등록되지 않은 번호
 * - lookup_failed: API 호출 자체가 실패(키 미설정/장애/일시정지 등)
 */
export interface NtsLookupResult {
  result: 'active' | 'suspended' | 'closed' | 'not_found' | 'lookup_failed';
  checkedAt: string;
  raw?: Record<string, unknown>;
  error?: string;
  /** 실패 응답의 HTTP 상태. 응답 자체가 없으면(타임아웃 등) 비어 있다 */
  errorStatus?: number;
  /** 실패 응답의 본문. 라이브에서만 나는 5xx 의 정체를 사후에 볼 수 있는 유일한 흔적이다 */
  errorBody?: string;
}

/**
 * 국세청 진위확인(validate) 결과. 상태조회와 달리 `사업자번호 + 대표자명 + 개업일자` 조합이
 * 국세청 기록과 일치하는지를 확인해준다 — 대표자명 검증은 이 경로로만 가능하다.
 *
 * 주의: 조합의 실존만 확인할 뿐 "신청자가 그 대표자 본인인가"는 알 수 없다. 사업자등록증
 * 사본만 있으면 세 값을 모두 알 수 있으므로, 신원 연결은 별도의 실명인증이 필요하다.
 */
export interface NtsValidateResult {
  /** 세 값의 조합이 국세청 기록과 일치하는가 */
  valid: boolean;
  /** 신청자가 낸 입력값. 조회 실패로 raw 가 없을 때도 재검증할 수 있도록 우리가 직접 남긴다 */
  requested?: { businessNumber: string; representativeName: string; startDate: string };
  /** 일치하지 않을 때 국세청이 준 사유 */
  invalidReason?: string;
  /** 진위확인과 함께 돌아오는 납세자 상태 (계속/휴업/폐업 등) */
  status: NtsLookupResult['result'];
  checkedAt: string;
  raw?: Record<string, unknown>;
  error?: string;
  errorStatus?: number;
  errorBody?: string;
}

export interface BusinessMetadata {
  nts?: NtsLookupResult;
  ntsValidate?: NtsValidateResult;
  [key: string]: unknown;
}

// 사업자 생성 dto
//
// metadata 는 클라이언트가 보낼 수 없다. 예전에는 body 로 받은 metadata.nts.result 로 승인
// 여부를 정했는데, 그러면 `{"nts":{"result":"active"}}` 만 실어 보내도 국세청 조회 없이
// 자동 승인됐다. 지금은 서버가 직접 국세청을 호출해 metadata 를 만든다.
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

  @ValidateIf((o) => !o.fileUrl)
  @IsNotEmpty({ message: '개업일자는 필수입니다.' })
  @Transform(({ value }) => value?.replace(/\D/g, ''))
  @Matches(/^\d{8}$/, { message: '개업일자는 YYYYMMDD 8자리로 입력해주세요.' })
  startDate?: string;

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
  @Length(1, 20, { message: '대표자명은 1자 이상 20자 이하여야 합니다.' })
  representativeName?: string;

  @ValidateIf((o) => !o.fileUrl)
  @IsNotEmpty({ message: '개업일자는 필수입니다.' })
  @Transform(({ value }) => value?.replace(/\D/g, ''))
  @Matches(/^\d{8}$/, { message: '개업일자는 YYYYMMDD 8자리로 입력해주세요.' })
  startDate?: string;

  @IsOptional()
  @IsString({ message: '증빙 검증 파일 URL은 문자열이어야 합니다.' })
  fileUrl?: string | null;
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
