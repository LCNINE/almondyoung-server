import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsUUID } from 'class-validator';

/** 목록 화면이 카드 수만큼 단건 조회하는 걸 막기 위한 배치 조회. */
export class RatingSummariesQueryDto {
  @ApiProperty({
    description: '상품 ID 목록 (쉼표 구분, 최대 100개)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a,9a2c1e40-5d13-4d1e-9a77-1f0b2c3d4e5f',
  })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  // 버전을 고정하지 않는다 — 신규 상품 id 가 UUID v7 로 발급되고 있어, v4 로 좁히면
  // v7 상품이 섞인 배치가 통째로 400 이 되어 그 화면의 평점이 전부 사라진다.
  // 단건 rating-summary 도 같은 이유로 버전 무관 검증이다.
  @IsUUID(undefined, { each: true })
  productIds: string[];
}

/** 목록 카드가 쓰는 값만 담는다 — 별점 분포는 상세 화면 전용이라 제외. */
export class RatingSummaryListItemDto {
  @ApiProperty({ description: '상품 ID' })
  productId: string;

  @ApiProperty({ description: '평균 평점', example: 4.3 })
  averageRating: number;

  @ApiProperty({ description: '총 리뷰 수', example: 128 })
  totalCount: number;
}

export class RatingSummariesResponseDto {
  @ApiProperty({ description: '상품별 평점 요약', type: [RatingSummaryListItemDto] })
  summaries: RatingSummaryListItemDto[];
}

export class RatingSummaryQueryDto {
  @ApiProperty({
    description: '상품 ID (UUID)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsUUID()
  productId: string;
}

export class RatingSummaryResponseDto {
  @ApiProperty({
    description: '상품 ID',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  productId: string;

  @ApiProperty({ description: '평균 평점', example: 4.3 })
  averageRating: number;

  @ApiProperty({ description: '총 리뷰 수', example: 128 })
  totalCount: number;

  @ApiProperty({
    description: '평점별 리뷰 수 분포 (1~5)',
    example: { 1: 5, 2: 8, 3: 15, 4: 30, 5: 70 },
  })
  ratingDistribution: Record<number, number>;
}
