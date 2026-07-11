import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class ReleaseReservationDto {
  @ApiProperty({
    description: '예약 해제 사유',
    example: 'Order cancelled',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
