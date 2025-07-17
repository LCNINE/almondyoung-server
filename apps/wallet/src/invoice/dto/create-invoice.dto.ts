import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';

export enum InvoiceType {
  SUBSCRIPTION = 'SUBSCRIPTION',
  PRODUCT = 'PRODUCT',
}

export class CreateInvoiceDto {
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['SUBSCRIPTION', 'PRODUCT'])
  invoiceType: string;

  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['KRW'])
  currency: string;

  @IsDateString()
  @IsOptional()
  dueAt?: string;
}
