import { ApiProperty } from '@nestjs/swagger';
import { IsHexColor, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateCsLabelDto {
  @ApiProperty({ description: '라벨 이름(유일)' })
  @IsString()
  @MaxLength(96)
  name: string;

  @ApiProperty({ description: '색상(hex)', required: false, default: '#888888' })
  @IsHexColor()
  @IsOptional()
  color?: string;

  @ApiProperty({ description: '정렬 순서', required: false, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class ApplyCsLabelDto {
  @ApiProperty({ description: '적용할 라벨 ID' })
  @IsUUID()
  labelId: string;
}
