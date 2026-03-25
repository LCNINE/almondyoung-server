import { ApiProperty } from '@nestjs/swagger';

export class ProductMasterEntity {
  @ApiProperty({ description: '마스터 ID' })
  id: string;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '생성자', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: '삭제일시', nullable: true })
  deletedAt: Date | null;

  @ApiProperty({ description: '삭제자', nullable: true })
  deletedBy: string | null;
}
