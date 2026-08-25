import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';

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

/**
 * 개업일자가 달력에 실제로 존재하는 과거 날짜인지 검사한다.
 *
 * `^\d{8}$` 만으로는 `20218326`(83월)·`10151104`(1015년)·미래 날짜가 그대로 통과해
 * 국세청 진위확인에서 "확인할 수 없습니다" 로 떨어지고 심사중에 갇힌다 (2026-08-24 실측 9건).
 * 접수 단계에서 걸러 사용자가 바로 고칠 수 있게 한다.
 */
@ValidatorConstraint({ name: 'isRealStartDate' })
export class IsRealStartDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    if (year < 1900) return false;

    const parsed = new Date(Date.UTC(year, month - 1, day));
    const isRealDate =
      parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
    if (!isRealDate) return false;

    // KST 가 UTC 보다 9시간 앞서므로 "오늘 개업" 이 UTC 기준 미래로 보일 수 있다 — 하루 여유를 둔다.
    return parsed.getTime() <= Date.now() + 24 * 60 * 60 * 1000;
  }

  defaultMessage(): string {
    return '개업일자를 확인해주세요. 사업자등록증에 적힌 개업연월일을 YYYYMMDD 로 입력합니다.';
  }
}

/**
 * 사업자등록번호 체크섬. 마지막 자리가 앞 9자리로 계산되는 검증숫자다.
 *
 * `1234567890` 처럼 계산상 존재할 수 없는 번호가 그대로 접수돼 심사중에 쌓이거나
 * (더 나쁘게는) 승인된 레코드에 실리는 걸 막는다 — 2026-08-25 라이브 실측으로
 * **승인된 5건이 국세청에 없는 번호**를 들고 있었고, 4건은 ntsValidate 자체가 없었다
 * (서류 승인 후 현금영수증 경로로 번호만 채워진 건. 그 경로는 10자리만 봤다).
 *
 * 라이브 346건 대조에서 오탐 0 — 실패한 6건은 국세청 조회로도 전부 "등록되지 않은 번호" 였다.
 */
@ValidatorConstraint({ name: 'isBusinessNumberChecksum' })
export class IsBusinessNumberChecksumConstraint implements ValidatorConstraintInterface {
  private static readonly WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !/^\d{10}$/.test(value)) return false;

    const digits = [...value].map(Number);
    let sum = digits
      .slice(0, 9)
      .reduce((acc, d, i) => acc + d * IsBusinessNumberChecksumConstraint.WEIGHTS[i], 0);
    sum += Math.floor((digits[8] * 5) / 10);

    return (10 - (sum % 10)) % 10 === digits[9];
  }

  defaultMessage(): string {
    return '사업자등록번호를 다시 확인해주세요. 존재할 수 없는 번호입니다.';
  }
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
  @Validate(IsBusinessNumberChecksumConstraint)
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
  @Validate(IsRealStartDateConstraint)
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
  @Validate(IsBusinessNumberChecksumConstraint)
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
  @Validate(IsRealStartDateConstraint)
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
  @Validate(IsBusinessNumberChecksumConstraint)
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
