import { IsUUID, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../shared/dto';

export class GetStockQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'SKU ID 필터', required: false })
  @IsUUID()
  @IsOptional()
  skuId?: string;

  @ApiProperty({ description: '창고 ID (필수)', required: true })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;
}
