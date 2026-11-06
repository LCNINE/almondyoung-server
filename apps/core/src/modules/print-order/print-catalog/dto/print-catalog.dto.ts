import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsString, Max, Min, ValidateNested } from 'class-validator';

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
}

export class PrintQuotesBodyDto extends PrintSizeQueryDto {
  @ApiProperty({ type: [PrintComboDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PrintComboDto)
  combos!: PrintComboDto[];
}
