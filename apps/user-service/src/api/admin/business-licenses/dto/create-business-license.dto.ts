import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JsonValue } from 'type-fest';

export class CreateBusinessLicenseDto {
  @ApiProperty({
    description: '사업자등록증 인증 파일',
    required: false,
    type: String,
  })
  @IsOptional({
    message: 'verificationFile는 선택사항입니다.',
  })
  @IsString({
    message: 'verificationFile는 문자열이어야 합니다.',
  })
  verificationFile?: string;

  @ApiProperty({
    description: '상점 ID',
    required: false,
    type: String,
  })
  @IsOptional()
  @IsString({
    message: 'shopId는 문자열이어야 합니다.',
  })
  shopId?: string;

  @ApiProperty({
    description: '사업자 등록 번호 (10자리)',
    required: true,
    type: String,
    minLength: 10,
    maxLength: 10,
  })
  @ValidateIf((o) => !o.verificationFile)
  @IsNotEmpty({
    message: 'businessNumber는 필수입니다.',
  })
  @IsString({
    message: 'businessNumber는 문자열이어야 합니다.',
  })
  @Length(10, 10)
  businessNumber: string;

  @ApiProperty({
    description: '대표자 이름',
    required: true,
    type: String,
    minLength: 1,
    maxLength: 100,
  })
  @ValidateIf((o) => !o.verificationFile)
  @IsNotEmpty({
    message: 'representativeName는 필수입니다.',
  })
  @IsString({
    message: 'representativeName는 문자열이어야 합니다.',
  })
  @Length(1, 100)
  representativeName?: string;

  @ApiProperty({
    description: '추가 메타데이터',
    required: false,
    type: Object,
  })
  @IsOptional({
    message: 'metadata는 선택사항입니다.',
  })
  @IsObject({
    message: 'metadata는 객체이어야 합니다.',
  })
  metadata?: JsonValue;
}
