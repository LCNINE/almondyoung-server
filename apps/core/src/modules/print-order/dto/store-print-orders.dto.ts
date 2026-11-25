import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ReuploadPrintFileDto {
  @ApiProperty({ description: '고객이 새로 올린 인쇄 파일 ID (file-service customer-print-file)' })
  @IsUUID()
  fileId!: string;
}

export class CustomerFileRejectionDto {
  @ApiProperty() salesOrderLineId!: string;
  @ApiProperty({ description: '채널(Medusa) 주문 ID' }) channelOrderId!: string;
  @ApiProperty({ description: '채널(Medusa) 주문 줄 ID', nullable: true, type: String }) channelOrderItemId!:
    | string
    | null;
  @ApiProperty() productName!: string;
  @ApiProperty() rejectedAt!: Date;
  @ApiProperty({ description: '와우프레스 작업상태 코드', nullable: true, type: Number }) jobstat!: number | null;
  @ApiProperty({ description: '다시 올릴 때 받는 확장자', type: [String] }) acceptedExtensions!: string[];
}
