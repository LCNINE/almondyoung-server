import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, MaxLength, IsBoolean } from 'class-validator';

export class CreateTagValueBodyDto {
  @ApiProperty({
    description: '태그 값 이름',
    minLength: 1,
    maxLength: 100,
    example: 'C컬',
  })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: '표시 순서',
    minimum: 0,
    required: false,
    default: 0,
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiProperty({
    description: '활성 상태',
    required: false,
    default: true,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

