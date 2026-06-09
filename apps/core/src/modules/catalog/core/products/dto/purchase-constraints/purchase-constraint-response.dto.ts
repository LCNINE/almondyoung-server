import { ApiProperty } from '@nestjs/swagger';

export class PurchaseConstraintResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  requiresMembership: boolean;

  @ApiProperty({ nullable: true })
  lifetimeQuantityLimit: number | null;
}
