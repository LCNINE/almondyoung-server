import { ApiProperty } from '@nestjs/swagger';

export class UploadResponseDto {
  @ApiProperty({
    description: 'Unique file ID',
    example: '01933e7a-1234-7890-abcd-0123456789ab',
  })
  id: string;

  @ApiProperty({
    description: 'File access URL',
    example: 'https://bucket.s3.amazonaws.com/products/images/2025/01/file.jpg',
  })
  url: string;

  @ApiProperty({
    description: 'Stored file name',
    example: '01933e7a-1234-7890-abcd-0123456789ab.jpg',
  })
  fileName: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
  })
  size: number;

  @ApiProperty({
    description: 'Current file status',
    enum: ['pending', 'active', 'deleted'],
    example: 'pending',
  })
  status: string;
}

export class BatchUploadResponseDto {
  @ApiProperty({
    description: 'List of uploaded files',
    type: [UploadResponseDto],
  })
  files: UploadResponseDto[];

  @ApiProperty({
    description: 'Total number of files uploaded',
    example: 3,
  })
  total: number;
}

