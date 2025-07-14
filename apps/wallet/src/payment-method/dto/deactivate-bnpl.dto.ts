import { IsNotEmpty, IsString, IsEnum } from 'class-validator';
import { BNPLActor } from './activate-bnpl.dto';

export class DeactivateBNPLDto {
  @IsNotEmpty()
  @IsString()
  paymentMethodId: string;

  @IsNotEmpty()
  @IsEnum(BNPLActor)
  actor: BNPLActor;
}
