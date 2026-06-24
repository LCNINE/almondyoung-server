import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import * as schema from '../../../../../database/drizzle/schema';
import { statusEnum } from '../../../../../database/drizzle/schema';

export class BusinessAdminUpdateDto {
  @IsString({ message: '증빙 검증 파일 URL은 문자열이어야 합니다.' })
  @IsOptional({ message: '증빙 검증 파일 URL은 선택사항입니다.' })
  fileUrl?: string | null;

  @IsString({ message: '검토 코멘트는 문자열이어야 합니다.' })
  @IsOptional({ message: '검토 코멘트는 선택사항입니다.' })
  reviewComment?: string;

  @IsString({ message: '사업자번호는 문자열이어야 합니다.' })
  @IsOptional({ message: '사업자번호는 선택사항입니다.' })
  businessNumber?: string;

  @IsString({ message: '대표자명은 문자열이어야 합니다.' })
  @IsOptional({ message: '대표자명은 선택사항입니다.' })
  representativeName?: string;

  @IsIn(statusEnum.enumValues, { each: true })
  @IsString({ message: '상태는 문자열이어야 합니다.' })
  @IsOptional({ message: '상태는 선택사항입니다.' })
  status?: (typeof schema.statusEnum.enumValues)[number];

  @IsString({ message: '사용자 ID는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '사용자 ID는 필수입니다.' })
  userId: string;
}
