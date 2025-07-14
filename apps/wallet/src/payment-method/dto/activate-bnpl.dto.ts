import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsEnum,
  Min,
  Max,
} from 'class-validator';

export enum BNPLActor {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
}

export class ActivateBNPLDto {
  @IsNotEmpty()
  @IsString()
  paymentMethodId: string;

  @IsNotEmpty()
  @IsString()
  settlementPaymentMethodId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  creditLimit: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(31)
  billingCycleDay: number;

  @IsNotEmpty()
  @IsEnum(BNPLActor)
  actor: BNPLActor;
}
