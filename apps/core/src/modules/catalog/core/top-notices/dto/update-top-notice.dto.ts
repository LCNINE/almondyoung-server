import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TOP_NOTICE_TEXT_MAX_LENGTH } from '../top-notice.constants';

/** 값을 비우려면 null 을 보낸다. 필드를 생략하면 기존 값이 유지된다. */
const Nullable = () => ValidateIf((_object, value) => value !== null);

/** 비울 수 없는 필드. 생략은 허용하되 null 은 검증에 걸린다. */
const Omittable = () => ValidateIf((_object, value) => value !== undefined);

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateTopNoticeDto {
  @ApiProperty({ description: '띠 문구 (한 줄)', required: false, maxLength: TOP_NOTICE_TEXT_MAX_LENGTH })
  @Omittable()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOP_NOTICE_TEXT_MAX_LENGTH)
  text?: string;

  @ApiProperty({ description: '띠 클릭 시 이동할 주소', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @Transform(trim)
  @IsString()
  linkUrl?: string | null;

  @ApiProperty({ description: '게시 시작 일시', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsDateString()
  displayStartAt?: string | null;

  @ApiProperty({ description: '게시 종료 일시', required: false, nullable: true })
  @IsOptional()
  @Nullable()
  @IsDateString()
  displayEndAt?: string | null;

  @ApiProperty({ description: '활성화 여부', required: false })
  @Omittable()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '정렬 순서', required: false })
  @Omittable()
  @IsInt()
  sortOrder?: number;
}
