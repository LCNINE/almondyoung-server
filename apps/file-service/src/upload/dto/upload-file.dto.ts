import { IsEnum, IsOptional, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FILE_CONTEXTS, FileContext } from '../../shared/constants/file-contexts';

export class UploadFileDto {
  @ApiProperty({
    description: 'Context in which the file is being uploaded',
    enum: Object.values(FILE_CONTEXTS),
    example: 'product-image',
  })
  @IsEnum(FILE_CONTEXTS)
  context: FileContext;

  @ApiProperty({
    description: 'Additional metadata for the file',
    required: false,
    example: { width: 1920, height: 1080 },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

