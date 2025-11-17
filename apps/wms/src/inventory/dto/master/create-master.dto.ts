import { IsString, IsNotEmpty, IsOptional, IsObject, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class OptionValue {
  @ApiProperty({ 
    description: '옵션 이름 (예: 색상, 사이즈)', 
    example: '색상',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ 
    description: '옵션 값 목록', 
    type: [String],
    example: ['빨강', '파랑', '노랑'],
    required: true
  })
  @IsArray()
  @IsString({ each: true })
  values: string[];
}

export class OptionSchema {
  @ApiProperty({ 
    description: '옵션 목록 (옵션 그룹 배열)', 
    type: [OptionValue],
    required: false,
    example: [
      { name: '색상', values: ['빨강', '파랑', '노랑'] },
      { name: '사이즈', values: ['S', 'M', 'L'] }
    ]
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionValue)
  options?: OptionValue[];
}

export class CreateMasterDto {
  @ApiProperty({ 
    description: '마스터 이름 (제품명)', 
    example: '아이폰 15 프로',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ 
    description: '마스터 코드 (고유 식별 코드)', 
    example: 'M-IPHONE15PRO',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  masterCode: string;

  @ApiProperty({ 
    description: '옵션 스키마 (옵션 그룹 정의 - 색상, 사이즈 등)', 
    type: OptionSchema,
    required: false,
    example: {
      options: [
        { name: '색상', values: ['빨강', '파랑', '노랑'] },
        { name: '사이즈', values: ['S', 'M', 'L', 'XL'] }
      ]
    }
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OptionSchema)
  optionSchema?: OptionSchema;

  @ApiProperty({ 
    description: '기본 정책 설정 (JSON 객체 - 재고 관리 정책 등)', 
    type: Object,
    required: false,
    example: { 
      autoCreateSkus: true, 
      defaultLocation: 'A-01-01',
      safetyStock: 10,
      reorderPoint: 20
    }
  })
  @IsOptional()
  @IsObject()
  defaultPolicy?: Record<string, unknown>;

  @ApiProperty({ 
    description: '마스터 상태', 
    enum: ['active', 'archived'],
    required: false,
    example: 'active',
    default: 'active'
  })
  @IsEnum(['active', 'archived'])
  @IsOptional()
  status?: 'active' | 'archived';
}

