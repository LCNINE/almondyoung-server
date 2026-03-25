import { ApiProperty } from '@nestjs/swagger';

export class ProductMasterMetadataDto {
  @ApiProperty({ description: 'Master ID' })
  id: string;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '생성자', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: '삭제일시', nullable: true })
  deletedAt: string | null;

  @ApiProperty({ description: '삭제자', nullable: true })
  deletedBy: string | null;
}
