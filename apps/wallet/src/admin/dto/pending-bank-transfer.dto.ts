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

  @ApiPropertyOptional({ description: '입금 안내 은행명 (authorize 시 스냅샷)' })
  bankName: string | null;

  @ApiPropertyOptional({ description: '입금 안내 계좌번호 (authorize 시 스냅샷)' })
  accountNumber: string | null;

  @ApiPropertyOptional({ description: '입금 안내 예금주 (authorize 시 스냅샷)' })
  accountHolder: string | null;
}
