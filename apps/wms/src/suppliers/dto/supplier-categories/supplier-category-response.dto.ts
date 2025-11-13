import { ApiProperty } from '@nestjs/swagger';

export class SupplierCategoryResponseDto {
  @ApiProperty({ description: 'Category ID' })
  id: string;

  @ApiProperty({ description: 'Category name' })
  name: string;

  @ApiProperty({ description: 'Category description', required: false, nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Created at' })
  createdAt: string;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: string;
}

