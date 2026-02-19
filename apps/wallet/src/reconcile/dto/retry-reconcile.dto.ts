import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RetryReconcileDto {
  @IsString()
  reasonCode!: string;

  @IsOptional()
  @IsString()
  reasonMessage?: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
