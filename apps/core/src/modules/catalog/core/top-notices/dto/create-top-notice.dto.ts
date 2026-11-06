import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TOP_NOTICE_TEXT_MAX_LENGTH } from '../top-notice.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTopNoticeDto {
  @ApiProperty({ description: '띠 문구 (한 줄)', example: '5만원 이상 무료배송', maxLength: TOP_NOTICE_TEXT_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOP_NOTICE_TEXT_MAX_LENGTH)
  text: string;

  @ApiProperty({
    description: '띠 클릭 시 이동할 주소. http(s) 주소 또는 "/" 로 시작하는 사이트 내 경로 (예: /cs/notice/<id>)',
    required: false,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  linkUrl?: string;

  @ApiProperty({ description: '게시 시작 일시', required: false })
  @IsOptional()
  @IsDateString()
  displayStartAt?: string;

  @ApiProperty({ description: '게시 종료 일시', required: false })
  @IsOptional()
  @IsDateString()
  displayEndAt?: string;

  @ApiProperty({ description: '활성화 여부', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '정렬 순서 (낮을수록 먼저)', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
