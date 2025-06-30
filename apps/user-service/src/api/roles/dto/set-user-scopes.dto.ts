import { IsOptional, IsString } from 'class-validator';

export class SetUserScopesDto {
  @IsString()
  scopes: string[];

  @IsString()
  description: string;
}
