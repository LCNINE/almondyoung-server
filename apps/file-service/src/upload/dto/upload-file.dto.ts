import { IsString, IsOptional, IsObject, IsArray, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadFileDto {
  @ApiProperty({
    description: 'File context ID (validated against file_contexts table)',
    example: 'product-image',
  })
  @IsString()
  contextId: string;

  @ApiProperty({
    description: 'Whether the file should be publicly accessible. ' +
                 'Required for contexts that allow both public and private.',
    required: false,
    example: true,
  })
  @IsOptional()
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

