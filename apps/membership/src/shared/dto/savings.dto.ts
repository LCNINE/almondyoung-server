import { ApiProperty } from '@nestjs/swagger';

/**
 * 월별 절약액 DTO
 */
export class MonthlySavingsDto {
  @ApiProperty({ example: 'user_123', description: '사용자 ID' })
  userId: string;

  @ApiProperty({ example: '2025-11', description: '조회한 년월 (YYYY-MM)' })
  yearMonth: string;

  @ApiProperty({
    example: 50000,
    description: '총 절약 금액 (원)',
  })
  totalSavings: number;

  @ApiProperty({ example: 12, description: '주문 건수' })
  orderCount: number;

  @ApiProperty({
    example: {
      startDate: '2025-11-01T00:00:00Z',
      endDate: '2025-11-30T23:59:59Z',
    },
    description: '조회 기간',
  })
  period: {
    startDate: Date;
    endDate: Date;
  };
}

/**
 * 기간별 절약액 DTO
 */
export class RangeSavingsDto {
  @ApiProperty({ example: 'user_123', description: '사용자 ID' })
  userId: string;

  @ApiProperty({ example: 150000, description: '총 절약 금액 (원)' })
  totalSavings: number;

  @ApiProperty({ example: 35, description: '총 주문 건수' })
  orderCount: number;

  @ApiProperty({
    example: {
      startDate: '2025-09-01T00:00:00Z',
      endDate: '2025-11-30T23:59:59Z',
    },
    description: '조회 기간',
  })
  period: {
    startDate: Date;
    endDate: Date;
  };

  @ApiProperty({
    example: [
      { yearMonth: '2025-09', savings: 40000, orderCount: 10 },
      { yearMonth: '2025-10', savings: 60000, orderCount: 13 },
      { yearMonth: '2025-11', savings: 50000, orderCount: 12 },
    ],
    description: '월별 breakdown',
  })
  monthlyBreakdown: Array<{
    yearMonth: string;
    savings: number;
    orderCount: number;
  }>;
}
