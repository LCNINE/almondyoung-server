import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class OwnershipOrderStatusDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  channelOrderIds: string[];
}

export class OwnershipOrderStatusResponseDto {
  @ApiProperty({ type: [String], description: '본인의 활성 다운로드 권한이 존재하는 Medusa 주문 ID' })
  grantedOrderIds: string[];
}
