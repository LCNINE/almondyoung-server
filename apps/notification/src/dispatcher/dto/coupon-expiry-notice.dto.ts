import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ExpiringCouponDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty()
  @IsISO8601()
  expiresAt: string;
}

export class CouponExpiryNoticeDto {
  @ApiProperty({ description: 'user-service 회원 id (Medusa customer.metadata.almond_user_id)' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ type: [ExpiringCouponDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExpiringCouponDto)
  coupons: ExpiringCouponDto[];
}
