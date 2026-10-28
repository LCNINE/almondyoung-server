import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReleaseCustomerReturnPickupDto {
  /** Medusa 반품 id — core 의 `customer_returns.channel_return_id` */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  channelReturnId!: string;
}
