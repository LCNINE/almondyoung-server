import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LinkAlmondTemplateProductDto {
  @ApiProperty({ description: '연결할 상품 마스터 id (Medusa handle)', format: 'uuid' })
  @IsUUID()
  productId: string;
}
