import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_REVIEW_MEDIA_COUNT } from '../constants';

export class CreateReviewDto {
  @ApiProperty({
    description: '리뷰 작성 자격 ID (UUID)',
    example: 'a1b2c3d4-5e6f-7890-abcd-ef1234567890',
  })
  @IsUUID()
  eligibilityId: string;

  @ApiProperty({
    description: '상품 ID (UUID)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsUUID()
  productId: string;

  @ApiProperty({ description: '평점', minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ description: '리뷰 본문', example: '아주 만족합니다.' })
  @IsString()
  @MinLength(1)
  content: string;

  @ApiPropertyOptional({
    description: '첨부 미디어 파일 ID 목록',
    type: [String],
    maxItems: MAX_REVIEW_MEDIA_COUNT,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REVIEW_MEDIA_COUNT)
  @IsUUID('all', { each: true })
  mediaFileIds?: string[];
}

/**
 * 관리자(리테일팀)가 다른 채널의 고객 후기를 옮겨 적을 때의 입력.
 * 작성 권한(`eligibilityId`)이 없다 — 이 리뷰는 회원 명의가 아니다.
 */
export class AdminCreateReviewDto {
  @ApiProperty({ description: '상품(마스터) ID (UUID)', example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a' })
  @IsUUID()
  productId: string;

  @ApiProperty({ description: '원 작성자명. 쇼핑몰에는 마스킹되어 보인다', maxLength: 100, example: '홍길동' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  authorName: string;

  @ApiProperty({
    description: '원 작성 시각 (ISO 8601, 시각과 오프셋 필수). 미래 시각은 거절한다',
    example: '2026-09-01T00:00:00+09:00',
  })
  @IsISO8601({ strict: true })
  // 날짜만 오면 UTC 자정으로 해석돼 KST 09:00 이 된다 — 시각과 오프셋을 강제한다.
  @Matches(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, {
    message: 'writtenAt must include time and UTC offset',
  })
  writtenAt: string;

  @ApiProperty({ description: '평점', minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ description: '리뷰 본문', example: '향이 좋아요.' })
  @IsString()
  @Matches(/\S/, { message: 'content must not be blank' })
  content: string;

  @ApiPropertyOptional({
    description: '첨부 미디어 파일 ID 목록 (file-service review-media)',
    type: [String],
    maxItems: MAX_REVIEW_MEDIA_COUNT,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REVIEW_MEDIA_COUNT)
  @IsUUID('all', { each: true })
  mediaFileIds?: string[];
}
