import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

// ===== Status Breakdown DTO =====
export class StatusBreakdownDto {
  @ApiProperty({
    description: '제품 상태 (active/inactive)',
    example: 'active',
  })
  status: string;

  @ApiProperty({
    description: '해당 상태의 제품 수',
    example: 150,
    minimum: 0,
  })
  count: number;
}

// ===== Approval Breakdown DTO =====
export class ApprovalBreakdownDto {
  @ApiProperty({
    description: '승인 상태 (draft/pending/approved/rejected)',
    example: 'approved',
  })
  approvalStatus: string;

  @ApiProperty({
    description: '해당 승인 상태의 제품 수',
    example: 120,
    minimum: 0,
  })
  count: number;
}

// ===== Dashboard Metrics Response DTO =====
export class DashboardMetricsResponseDto {
  @ApiProperty({
    description: '전체 제품 수 (소프트 삭제 제외)',
    example: 250,
    minimum: 0,
  })
  totalProducts: number;

  @ApiProperty({
    description: '오늘 등록된 제품 수',
    example: 15,
    minimum: 0,
  })
  createdToday: number;

  @ApiProperty({
    description: '재고 부족 제품 수 (WMS 연동 대기중)',
    example: 0,
    minimum: 0,
  })
  outOfStock: number;

  @ApiProperty({
    description: '상태별 제품 수',
    type: [StatusBreakdownDto],
  })
  byStatus: StatusBreakdownDto[];

  @ApiProperty({
    description: '승인 상태별 제품 수',
    type: [ApprovalBreakdownDto],
  })
  byApproval: ApprovalBreakdownDto[];
}

// ===== Top Product Item DTO =====
export class TopProductItemDto {
  @ApiProperty({
    description: '제품 ID',
    example: '01JCQX1234567890ABCDEFGH',
  })
  id: string;

  @ApiProperty({
    description: '제품명',
    example: 'Premium T-Shirt',
  })
  name: string;

  @ApiProperty({
    description: '브랜드명',
    example: 'BrandX',
    required: false,
    nullable: true,
  })
  brand: string | null;

  @ApiProperty({
    description: '기본 가격 (원)',
    example: 29900,
    minimum: 0,
  })
  basePrice: number;

  @ApiProperty({
    description: '제품 상태',
    example: 'active',
  })
  status: string;

  @ApiProperty({
    description: '승인 상태',
    example: 'approved',
  })
  approvalStatus: string;

  @ApiProperty({
    description: '등록일',
    example: '2025-10-28T12:00:00Z',
  })
  createdAt: Date;
}

// ===== Sales Trend Response DTO =====
export class SalesTrendResponseDto {
  @ApiProperty({
    description: '날짜 레이블 배열 (주문 서비스 연동 대기중)',
    example: [],
    type: [String],
  })
  labels: string[];

  @ApiProperty({
    description: '매출 데이터 배열 (주문 서비스 연동 대기중)',
    example: [],
    type: [Number],
  })
  data: number[];
}

// ===== Query DTOs =====
export class TopProductsQueryDto {
  @ApiProperty({
    description: '조회할 제품 수',
    example: 5,
    minimum: 1,
    maximum: 100,
    required: false,
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 5;
}

export class SalesTrendsQueryDto {
  @ApiProperty({
    description: '조회할 기간 (일 단위)',
    example: 30,
    minimum: 1,
    maximum: 365,
    required: false,
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number = 30;
}

