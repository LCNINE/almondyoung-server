import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreatePaymentDto {
  @IsNumber()
  @IsNotEmpty()
  invoiceId: number;

  @IsString()
  @IsNotEmpty()
  paymentMethodId: string; // ULID 타입으로 변경
}

export class RefundPaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentEventId: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsString()
  reason?: string;
}

export class FullRefundPaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentEventId: string;

  @IsString()
  reason?: string;
}

export class PartialRefundPaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentEventId: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsString()
  reason?: string;
} 