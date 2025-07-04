import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreatePaymentDto {
  @IsNumber()
  @IsNotEmpty()
  invoiceId: number;

  @IsString()
  @IsNotEmpty()
  paymentMethodId: string; // ULID 타입으로 변경
} 