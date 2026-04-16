import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, MaxLength, IsBoolean } from 'class-validator';

export class UpdateTagValueDto {
  @ApiProperty({
    description: '태그 값 이름',
    minLength: 1,
    maxLength: 100,
    required: false,
    example: 'C컬',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({
    description: '표시 순서',
    minimum: 0,
    required: false,
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiProperty({
    description: '활성 상태',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
