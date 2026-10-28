import { ApiProperty } from '@nestjs/swagger';
import { PURCHASE_SATISFACTION_REASONS, type PurchaseSatisfactionReason } from '../types';

export class PurchaseSatisfactionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() orderId: string;
  @ApiProperty() orderDisplayId: number;
  @ApiProperty() userId: string;
  @ApiProperty() rating: number;
  @ApiProperty({ enum: PURCHASE_SATISFACTION_REASONS, isArray: true }) reasons: PurchaseSatisfactionReason[];
  @ApiProperty({ nullable: true, type: String }) memo: string | null;
  @ApiProperty({ nullable: true, type: String }) checkedAt: string | null;
  @ApiProperty({ nullable: true, type: String }) checkedBy: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
