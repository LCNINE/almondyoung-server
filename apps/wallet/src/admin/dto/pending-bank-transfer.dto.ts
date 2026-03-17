import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '@app/shared';

export class PendingBankTransferListQueryDto extends PaginationQueryDto {}

export class PendingBankTransferResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  payableAmount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  userId: string | null;

  @ApiPropertyOptional()
  paymentMethodId: string | null;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  createdAt: Date;
}
