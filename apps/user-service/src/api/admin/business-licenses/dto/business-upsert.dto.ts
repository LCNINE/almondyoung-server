import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import * as schema from '../../../../../database/drizzle/schema';
import { statusEnum } from '../../../../../database/drizzle/schema';

/**
 * 관리자가 특정 사용자의 사업자 등록 정보를 등록/수정(upsert)할 때 사용하는 DTO.
 * 수동 입력 전용 — 사업자번호와 대표자명을 직접 받는다.
 */
export class BusinessAdminUpsertDto {
  @IsString({ message: '사업자번호는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '사업자번호는 필수입니다.' })
  @Length(10, 10, { message: '사업자번호는 10자리여야 합니다.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/-/g, '') : value))
  businessNumber: string;

  @IsString({ message: '대표자명은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '대표자명은 필수입니다.' })
  @Length(1, 100, { message: '대표자명은 1~100자여야 합니다.' })
  representativeName: string;

  @IsOptional()
  @IsIn(statusEnum.enumValues, { message: '유효하지 않은 상태값입니다.' })
  status?: (typeof schema.statusEnum.enumValues)[number];
}
