import { IsString, IsOptional, IsObject, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UploadFileDto {
  @ApiProperty({
    description: 'File context ID (validated against file_contexts table)',
    example: 'product-image',
  })
  @IsOptional()
  @IsString()
  contextId?: string;

  @ApiProperty({
    description: 'Legacy file context field. Use contextId instead.',
    required: false,
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  context?: string;

  @ApiProperty({
    description:
      'Whether the file should be publicly accessible. ' + 'Required for contexts that allow both public and private.',
    required: false,
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({
    description: 'Additional metadata for the file',
    required: false,
    example: { width: 1920, height: 1080 },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
