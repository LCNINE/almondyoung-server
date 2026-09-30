import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class RegisterReturnBinDto {
  @IsUUID()
  warehouseId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  barcode: string;
}

export class ReturnBinDto {
  @ApiProperty() id: string;
  @ApiProperty() barcode: string;
  @ApiProperty() warehouseId: string;
}

export class ReturnBinItemDto {
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty() sourceLocationId: string;
  @ApiProperty({ description: '원래 로케이션 — 되돌림 적치는 여기만 받는다' }) locationCode: string;
  @ApiProperty() qty: number;
}

export class ReturnBinContentsDto extends ReturnBinDto {
  @ApiProperty({ type: [ReturnBinItemDto] }) items: ReturnBinItemDto[];
}

export class ReturnBinRemovalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  barcode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  returnBinBarcode: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class WithdrawalRemovalDto {
  @ApiProperty() shipmentLineId: string;
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty() sourceLocationId: string;
  @ApiProperty() locationCode: string;
  @ApiProperty({ description: '박스에 든 몫 — 송장 스캔 화면에서 상품을 스캔해 바구니로' }) boxQty: number;
  @ApiProperty({ description: '토탈피킹 카트에 실린 몫 — 분류대에서 여분을 바구니로' }) cartQty: number;
}

export class ReturnBinRemovalResponseDto {
  @ApiProperty() shipmentId: string;
  @ApiProperty() workItemId: string;
  @ApiProperty() removedQty: number;
  @ApiProperty({ description: '마지막 몫이라 이 스캔으로 배치에서 나갔다' }) exited: boolean;
  @ApiProperty({ enum: ['draft', 'canceled'], nullable: true }) exitTo: 'draft' | 'canceled' | null;
  @ApiProperty({ type: String, nullable: true }) waitingOperationId: string | null;
  @ApiProperty({ type: [WithdrawalRemovalDto] }) removals: WithdrawalRemovalDto[];
}
