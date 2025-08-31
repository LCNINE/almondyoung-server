// dto/create-payment-method.dto.ts
import { IsString, IsOptional } from 'class-validator';

export class CreatePaymentMethodDto {
  @IsString()
  userId: string;

  @IsString()
  methodName: string;

  @IsOptional()
  @IsString()
  bankCode?: string;
}
