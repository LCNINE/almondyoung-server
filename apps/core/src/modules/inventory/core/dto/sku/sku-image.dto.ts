import { ApiProperty } from '@nestjs/swagger';

export class SkuImageDto {
  @ApiProperty({ description: 'Image ID' })
  id: string;

  @ApiProperty({ description: 'File Service upload ID' })
  uploadId: string;

  @ApiProperty({ description: 'Image URL from File Service' })
  url: string;

  @ApiProperty({ description: 'Is primary image', default: true })
  isPrimary: boolean;

  @ApiProperty({ description: 'Sort order', default: 0 })
  sortOrder: number;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;
}
