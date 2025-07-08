import { IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

export class CreatePaymentDto {
  @IsNumber()
  @IsNotEmpty()
  invoiceId: number;

  @IsString()
  @IsNotEmpty()
  paymentMethodId: string; // ULID 타입으로 변경
} 

export class RefundPaymentDto {
  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
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

export class PartialPaymentDto {
  @IsNumber()
  @IsNotEmpty()
  invoiceId: number;

  @IsString()
  @IsNotEmpty()
  paymentMethodId: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;
} 