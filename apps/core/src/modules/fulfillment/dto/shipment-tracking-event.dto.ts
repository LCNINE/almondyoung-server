import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ShipmentTrackingEventDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  providerEventId: string;

  @IsIn(['in_transit', 'delivered'])
  status: 'in_transit' | 'delivered';

  @IsISO8601({ strict: true })
  occurredAt: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  location?: string;
}
