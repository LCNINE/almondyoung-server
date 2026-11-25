import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';

export class ReleaseReservationDto {
  @ApiProperty({
    description: '예약 해제 사유',
    example: 'Order cancelled',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reason?: string;
}
