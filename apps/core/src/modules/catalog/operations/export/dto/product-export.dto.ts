import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

/** 목록 화면과 같은 필터 집합. '검색결과 전체 다운로드' 에 쓴다. */
export class ProductExportFiltersDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() q?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() brand?: string;

  @ApiProperty({ required: false, enum: ['active', 'inactive', 'draft'] })
  @IsOptional()
  @IsIn(['active', 'inactive', 'draft'])
  status?: 'active' | 'inactive' | 'draft';

  @ApiProperty({ required: false, enum: ['active', 'active-or-inactive', 'all'] })
  @IsOptional()
  @IsIn(['active', 'active-or-inactive', 'all'])
  mode?: 'active' | 'active-or-inactive' | 'all';

  @ApiProperty({ required: false, enum: ['all', 'in_stock', 'partial', 'sold_out'] })
  @IsOptional()
  @IsIn(['all', 'in_stock', 'partial', 'sold_out'])
  stock?: 'all' | 'in_stock' | 'partial' | 'sold_out';

  @ApiProperty({ required: false }) @IsOptional() @IsUUID() createdBy?: string;

  @ApiProperty({
    required: false,
    description: "공급처 UUID 배열. 'unassigned' 를 섞으면 공급처 미지정도 포함한다.",
  })
  @IsOptional()
  @IsArray()
  @Matches(/^(unassigned|[0-9a-fA-F-]{36})$/, { each: true })
  supplierId?: string[];

  @ApiProperty({ required: false }) @IsOptional() @IsDateString() createdFrom?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() createdTo?: string;

  @ApiProperty({ required: false, enum: ['createdAt', 'name', 'updatedAt'] })
  @IsOptional()
  @IsIn(['createdAt', 'name', 'updatedAt'])
  sort?: 'createdAt' | 'name' | 'updatedAt';

  @ApiProperty({ required: false, enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() deleted?: boolean;
}

export class ProductExportRequestDto {
  @ApiProperty({
    required: false,
    description: '내보낼 열 key 순서. 생략하면 기본 양식. GET /masters/export/columns 참고',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  columns?: string[];

  @ApiProperty({
    required: false,
    description: '선택항목 다운로드 — masterId 배열. 지정하면 filters 는 무시된다.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  ids?: string[];

  @ApiProperty({ required: false, type: ProductExportFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductExportFiltersDto)
  filters?: ProductExportFiltersDto;
}

export class ExportColumnDto {
  @ApiProperty({ description: '양식에 저장되는 식별자' }) key: string;
  @ApiProperty({ description: '화면·엑셀 헤더에 쓰는 이름' }) label: string;
}
