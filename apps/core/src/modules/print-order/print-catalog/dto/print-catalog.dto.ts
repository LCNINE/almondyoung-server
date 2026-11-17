import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const PRINT_KINDS = ['card', 'bizcard', 'nail', 'pet', 'mini', 'window', 'menu'] as const;

export class PrintKindParamDto {
  @ApiProperty({ enum: PRINT_KINDS })
  @IsIn(PRINT_KINDS)
  kind!: (typeof PRINT_KINDS)[number];
}

export class PrintSizeQueryDto {
  @ApiProperty({ description: '가로 mm' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10000)
  width!: number;

  @ApiProperty({ description: '세로 mm' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10000)
  height!: number;
}

export class PrintComboDto {
  @ApiProperty()
  @IsString()
  key!: string;

  @ApiProperty()
  @IsInt()
  paperno!: number;

  @ApiProperty()
  @IsInt()
  colorno!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  awk!: number[];

  @ApiProperty({ type: [String], required: false, description: '부자재 옵션 축마다 고른 선택지 키' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  accessories?: string[];
}

export class PrintQuotesBodyDto extends PrintSizeQueryDto {
  @ApiProperty({ type: [PrintComboDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PrintComboDto)
  combos!: PrintComboDto[];
}

export class PrintOptionExtraLabelDto {
  @ApiProperty({ description: '옵션 축 이름(예: 거치대)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  group!: string;

  @ApiProperty({ description: '고른 값 표시(예: 1개, 없음)' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value!: string;
}

export class PrintOptionLabelsDto {
  @ApiProperty({ description: '용지 옵션 표시' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  paper!: string;

  @ApiProperty({ description: '면 옵션 표시' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  side!: string;

  @ApiProperty({ description: '수량 옵션 표시' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  qty!: string;

  @ApiProperty({ type: [PrintOptionExtraLabelDto], required: false, description: '부자재 옵션 축 표시' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PrintOptionExtraLabelDto)
  extras?: PrintOptionExtraLabelDto[];
}

export class PublishPrintComboDto extends PrintComboDto {
  @ApiProperty({ description: '판매가(원)' })
  @IsInt()
  @Min(1)
  price!: number;

  @ApiProperty({ description: '멤버십가(원). 없으면 null', type: Number, nullable: true })
  @ValidateIf((o: PublishPrintComboDto) => o.memberPrice !== null)
  @IsInt()
  @Min(1)
  memberPrice!: number | null;

  @ApiProperty({ type: PrintOptionLabelsDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PrintOptionLabelsDto)
  optionLabels!: PrintOptionLabelsDto;
}

export class PublishPrintProductDto extends PrintSizeQueryDto {
  @ApiProperty()
  @IsUUID()
  templateId!: string;

  @ApiProperty({ enum: PRINT_KINDS })
  @IsIn(PRINT_KINDS)
  kind!: (typeof PRINT_KINDS)[number];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty({ description: '템플릿 미리보기 이미지 fileId' })
  @IsUUID()
  thumbnailFileId!: string;

  @ApiProperty({ type: [PublishPrintComboDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PublishPrintComboDto)
  combos!: PublishPrintComboDto[];
}

export class RepublishPrintProductDto extends PublishPrintProductDto {
  @ApiProperty({ description: '새 버전을 만들 기존 상품(master) ID' })
  @IsUUID()
  masterId!: string;
}
