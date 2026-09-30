import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

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
