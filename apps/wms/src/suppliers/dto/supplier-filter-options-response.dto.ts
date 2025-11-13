import { ApiProperty } from '@nestjs/swagger';

export class FilterOptionDto {
  @ApiProperty({ description: 'Option value' })
  value: string;

  @ApiProperty({ description: 'Option label' })
  label: string;
}

export class SupplierFilterOptionsResponseDto {
  @ApiProperty({ 
    description: 'Available supplier categories', 
    type: [FilterOptionDto] 
  })
  categories: FilterOptionDto[];

  @ApiProperty({ 
    description: 'Available purchase managers', 
    type: [FilterOptionDto] 
  })
  managers: FilterOptionDto[];

  @ApiProperty({ 
    description: 'Available search types', 
    type: [FilterOptionDto] 
  })
  searchTypes: FilterOptionDto[];
}

