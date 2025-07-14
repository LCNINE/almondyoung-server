import { IsNumber, IsString } from 'class-validator';

export class CreateBnplPaymentDto {
  @IsNumber()
  invoiceId: number;

  @IsString()
  paymentMethodId: string; // The ID of the method the user chose
}
