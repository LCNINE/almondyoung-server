import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductTagDto {
  @ApiProperty({ description: 'Tag group ID' })
  group_id: string;

  @ApiProperty({ description: 'Tag group name' })
  group_name: string;

  @ApiProperty({ description: 'Tag value ID' })
  value_id: string;

  @ApiProperty({ description: 'Tag value name' })
  value_name: string;
}

export class ProductSearchItemDto {
  @ApiProperty({ description: 'Master ID' })
  master_id: string;

  @ApiProperty({ description: 'Product ID (active version)' })
  product_id: string;

  @ApiProperty({ description: 'Version number' })
  version: number;

  @ApiProperty({ description: 'Product name' })
  name: string;

  @ApiPropertyOptional({ description: 'Product description' })
  description: string | null;

  @ApiPropertyOptional({ description: 'Product code' })
  product_code: string | null;

  @ApiPropertyOptional({ description: 'Brand' })
  brand: string | null;

  @ApiProperty({ description: 'Product status' })
  status: string;

  @ApiPropertyOptional({ description: 'Approval status' })
  approval_status: string | null;

  @ApiPropertyOptional({ description: 'Price' })
  price: number | null;

  @ApiPropertyOptional({ description: 'Category ID' })
  category_id: string | null;

  @ApiPropertyOptional({ description: 'Category name' })
  category_name: string | null;

  @ApiPropertyOptional({ description: 'Category path' })
  category_path: string | null;

  @ApiProperty({ description: 'Product tags', type: [ProductTagDto] })
  tags: ProductTagDto[];

  @ApiProperty({ description: 'Created at (ISO string)' })
  created_at: string;

  @ApiProperty({ description: 'Updated at (ISO string)' })
  updated_at: string;

  @ApiPropertyOptional({ description: 'Search relevance score' })
  _score?: number;
}

export class PaginationDto {
  @ApiProperty({ description: 'Current page' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Total items' })
  total: number;

  @ApiProperty({ description: 'Total pages' })
  totalPages: number;
}

export class TagValueAggregationDto {
  @ApiProperty({ description: 'Tag value ID' })
  value_id: string;

  @ApiProperty({ description: 'Tag value name' })
  value_name: string;

  @ApiProperty({ description: 'Product count' })
  count: number;
}

export class TagGroupAggregationDto {
  @ApiProperty({ description: 'Tag group ID' })
  group_id: string;

  @ApiProperty({ description: 'Tag group name' })
  group_name: string;

  @ApiProperty({ description: 'Tag values with counts', type: [TagValueAggregationDto] })
  values: TagValueAggregationDto[];
}

export class SearchAggregationsDto {
  @ApiPropertyOptional({
    description: 'Tag aggregations by group',
    type: [TagGroupAggregationDto],
  })
  tags?: TagGroupAggregationDto[];
}

export class ProductSearchResponseDto {
  @ApiProperty({ description: 'Search results', type: [ProductSearchItemDto] })
  items: ProductSearchItemDto[];

  @ApiProperty({ description: 'Pagination info', type: PaginationDto })
  pagination: PaginationDto;

  @ApiPropertyOptional({ description: 'Aggregations', type: SearchAggregationsDto })
  aggregations?: SearchAggregationsDto;
}

