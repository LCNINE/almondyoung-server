import { ApiProperty } from '@nestjs/swagger';
import { SupplierResponseDto } from './supplier-response.dto';

export class SupplierListResponseDto {
  @ApiProperty({ 
    description: 'List of suppliers', 
    type: [SupplierResponseDto] 
  })
  data: SupplierResponseDto[];

  @ApiProperty({ description: 'Total count of suppliers', minimum: 0 })
  total: number;

  @ApiProperty({ description: 'Current page number', minimum: 1 })
  page: number;

  @ApiProperty({ description: 'Items per page', minimum: 1, maximum: 100 })
  limit: number;
}

