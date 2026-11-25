import { ApiProperty } from '@nestjs/swagger';

export class StockGivenDto {
  @ApiProperty() at: Date;
  @ApiProperty({ type: [String], description: '재고를 받은 주문' }) orderNos: string[];
}
