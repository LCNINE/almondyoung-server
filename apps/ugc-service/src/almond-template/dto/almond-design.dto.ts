import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateAlmondDesignDto {
  @ApiProperty({
    description: '편집기 시안 JSON (version 1). productId·widthMm·heightMm 를 품는다. 이미지는 `file:<uuid>` 참조만',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  design: Record<string, unknown>;

  @ApiProperty({ description: '앞면 SVG. 작업사이즈(도련 포함) mm 단위 루트' })
  @IsString()
  frontSvg: string;

  @ApiPropertyOptional({ description: '뒷면 SVG. design.back 이 비어 있지 않으면 필수' })
  @IsOptional()
  @IsString()
  backSvg?: string;

  @ApiPropertyOptional({ format: 'uuid', description: '출발한 아몬드템플릿' })
  @IsOptional()
  @IsString()
  templateId?: string;
}

export class AlmondDesignCreatedResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() createdAt: string;
}

export class AlmondDesignResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) design: Record<string, unknown>;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) templateId: string | null;
  @ApiProperty() createdAt: string;
}

export class AdminAlmondDesignResponseDto extends AlmondDesignResponseDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
}
