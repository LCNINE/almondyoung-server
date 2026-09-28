import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';
import {
  LOGO_CONTEST_ENTRY_STATUS_VALUES,
  LOGO_CONTEST_SORT_VALUES,
  MAX_LOGO_CONTEST_MEDIA_COUNT,
  MIN_LOGO_CONTEST_MEDIA_COUNT,
  type LogoContestEntryStatus,
  type LogoContestSort,
} from '../constants/logo-contest.constants';

export class CreateLogoContestEntryDto {
  @ApiProperty({ description: '작품명', maxLength: 30 })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  title: string;

  @ApiPropertyOptional({ description: '작품 설명 (평문)', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: '출품 이미지 fileId. 첫 장은 가로 로고(대표 이미지), 둘째 장은 파비콘용 정사각 심볼',
    type: [String],
    minItems: MIN_LOGO_CONTEST_MEDIA_COUNT,
    maxItems: MAX_LOGO_CONTEST_MEDIA_COUNT,
  })
  @IsArray()
  @ArrayMinSize(MIN_LOGO_CONTEST_MEDIA_COUNT)
  @ArrayMaxSize(MAX_LOGO_CONTEST_MEDIA_COUNT)
  @IsUUID('all', { each: true })
  mediaFileIds: string[];

  @ApiProperty({ description: '작성자명. 가려서 내려보낼 값의 원본이다', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  authorName: string;

  @ApiProperty({ description: '출품 약관 동의. true 가 아니면 400' })
  @Equals(true)
  agreed: boolean;
}

export class LogoContestEntryListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '정렬', enum: LOGO_CONTEST_SORT_VALUES, default: 'latest' })
  @IsOptional()
  @IsIn(LOGO_CONTEST_SORT_VALUES)
  sort?: LogoContestSort;
}

export class AdminLogoContestEntryListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '상태 필터', enum: LOGO_CONTEST_ENTRY_STATUS_VALUES })
  @IsOptional()
  @IsIn(LOGO_CONTEST_ENTRY_STATUS_VALUES)
  status?: LogoContestEntryStatus;

  @ApiPropertyOptional({ description: '정렬', enum: LOGO_CONTEST_SORT_VALUES, default: 'popular' })
  @IsOptional()
  @IsIn(LOGO_CONTEST_SORT_VALUES)
  sort?: LogoContestSort;

  @ApiPropertyOptional({ description: '작품명·설명·출품자명 검색', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class UpdateLogoContestEntryStatusDto {
  @ApiProperty({ description: '출품작 상태', enum: LOGO_CONTEST_ENTRY_STATUS_VALUES })
  @IsIn(LOGO_CONTEST_ENTRY_STATUS_VALUES)
  status: LogoContestEntryStatus;
}

export class LogoContestEntryResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty({ description: '가린 작성자명', example: '정*식' }) authorName: string;
  @ApiProperty({ type: [String], description: '첫 장이 대표 이미지' }) mediaFileIds: string[];
  @ApiProperty() voteCount: number;
  @ApiProperty() isWinner: boolean;
  @ApiProperty() createdAt: string;
}

/**
 * 어드민도 가린 이름을 본다 — 여기 저장된 이름은 출품자가 보낸 값이라 정본이 아니다.
 * 아이디·이름·연락처는 어드민 화면이 `userId` 로 user-service 회원 정보를 붙여 보여준다.
 */
export class AdminLogoContestEntryResponseDto extends LogoContestEntryResponseDto {
  @ApiProperty() userId: string;
  @ApiProperty({ enum: LOGO_CONTEST_ENTRY_STATUS_VALUES }) status: LogoContestEntryStatus;
  @ApiProperty() agreedAt: string;
}

export class LogoContestStatusResponseDto {
  @ApiProperty() startsAt: string;
  @ApiProperty() endsAt: string;
  @ApiProperty({ description: '출품·투표를 받는 중인지' }) isOpen: boolean;
  @ApiProperty({ description: '마감됐는지' }) isClosed: boolean;
}

export class MyLogoContestStateResponseDto {
  @ApiProperty({ type: LogoContestEntryResponseDto, nullable: true })
  entry: LogoContestEntryResponseDto | null;

  @ApiProperty({ nullable: true, description: '내가 투표한 출품작 id. 마감 전에는 취소할 수 있다' })
  votedEntryId: string | null;
}
