import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** NHN 템플릿 등록 규격: 코드 20자, 이름 150자, 본문 1,300자, 버튼 5개·이름 14자·링크 500자 */
export class AlimtalkButtonDto {
  @ApiProperty({ description: '버튼 이름 (14자까지)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(14)
  name: string;

  @ApiProperty({ description: '모바일 링크. #{변수} 를 쓸 수 있다' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  linkMo: string;

  @ApiPropertyOptional({ description: 'PC 링크. 비우면 모바일 링크를 쓴다' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkPc?: string;
}

export class CreateAlimtalkTemplateDto {
  @ApiProperty({ description: '영문·숫자·밑줄 20자까지. 등록 뒤에는 바꿀 수 없다' })
  @Matches(/^[A-Za-z0-9_]{1,20}$/, { message: '템플릿 코드는 영문·숫자·밑줄로 20자까지 쓸 수 있습니다' })
  templateCode: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  templateName: string;

  @ApiProperty({ description: '본문 (1,300자까지). 광고 문구는 넣을 수 없다' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1300)
  templateContent: string;

  @ApiProperty({ description: '카카오 템플릿 카테고리 코드 (6자리)' })
  @Matches(/^\d{6}$/, { message: '카테고리를 고르세요' })
  categoryCode: string;

  @ApiProperty({ type: [AlimtalkButtonDto] })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AlimtalkButtonDto)
  buttons: AlimtalkButtonDto[];
}

export class UpdateAlimtalkTemplateDto extends OmitType(CreateAlimtalkTemplateDto, ['templateCode'] as const) {
  @ApiPropertyOptional({ description: '승인된 템플릿을 고치면 다시 심사를 받는다는 것을 확인했다' })
  @IsOptional()
  @IsBoolean()
  acknowledgeReReview?: boolean;
}

export class AlimtalkTemplateCommentDto {
  @ApiProperty({ description: '카카오 심사 담당자에게 남기는 문의. 반려된 템플릿에 남기면 다시 검수 중이 된다' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  comment: string;
}

export class VariableValueDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  value: string;
}

export class AlimtalkTestSendDto {
  @ApiProperty({ type: [VariableValueDto], description: '템플릿의 #{변수} 값' })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => VariableValueDto)
  variables: VariableValueDto[];
}
