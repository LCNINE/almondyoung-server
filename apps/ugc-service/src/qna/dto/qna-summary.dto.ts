import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class QnaSummaryQueryDto {
  @ApiProperty({
    description: '상품 ID (UUID)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsUUID()
  productId: string;
}

export class QnaSummaryResponseDto {
  @ApiProperty({
    description: '상품 ID',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  productId: string;

  @ApiProperty({ description: '전체 질문 수', example: 24 })
  totalCount: number;

  @ApiProperty({ description: '답변 완료 수', example: 18 })
  answeredCount: number;

  @ApiProperty({ description: '미답변 수', example: 6 })
  unansweredCount: number;
}
