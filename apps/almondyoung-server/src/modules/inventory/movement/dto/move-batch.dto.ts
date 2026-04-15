import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsUUID,
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MoveLineDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ description: '출발 로케이션 ID' })
  @IsUUID()
  fromLocationId!: string;

  @ApiProperty({ description: '도착 로케이션 ID' })
  @IsUUID()
  toLocationId!: string;

  @ApiProperty({ description: '이동 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: '라인 메모', required: false })
  @IsOptional()
  @IsString()
  memo?: string;
}

export class MoveBatchDto {
  @ApiProperty({ description: '창고 ID' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ description: '발생 시각(ISO)', required: false })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiProperty({ description: '작업자 ID', required: false })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiProperty({ description: '작업 메모', required: false })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiProperty({ type: [MoveLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MoveLineDto)
  lines!: MoveLineDto[];
}
