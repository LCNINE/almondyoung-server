import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateSupplierCategoryDto {
  @ApiProperty({ description: 'Category name' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ description: 'Category description', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}
