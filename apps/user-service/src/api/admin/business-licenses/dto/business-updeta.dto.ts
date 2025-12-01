import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";
import * as schema from '../../../../../database/drizzle/schema';
import { statusEnum } from "../../../../../database/drizzle/schema";

export class BusinessAdminUpdateDto {
    @IsOptional({ message: '증빙 검증 파일 업로드는 선택사항입니다.' })
    file?: Express.Multer.File | null;

    @IsString({ message: '증빙 검증 파일 URL은 문자열이어야 합니다.' })
    @IsOptional({ message: '증빙 검증 파일 URL은 선택사항입니다.' })
    fileUrl?: string | null;

    @IsString({ message: '검토 코멘트는 문자열이어야 합니다.' })
    @IsOptional({ message: '검토 코멘트는 선택사항입니다.' })
    reviewComment?: string;

    @IsIn(statusEnum.enumValues, { each: true })
    @IsString({ message: '상태는 문자열이어야 합니다.' })
    @IsNotEmpty({ message: '해당 사업자 등록 정보의 상태값을 설정해주세요.' })
    status: (typeof schema.statusEnum.enumValues)[number];

    @IsString({ message: '사용자 ID는 문자열이어야 합니다.' })
    @IsNotEmpty({ message: '사용자 ID는 필수입니다.' })
    userId: string
}