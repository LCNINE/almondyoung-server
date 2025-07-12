import { IsOptional, IsString } from 'class-validator';

export class SetUserScopesDto {
  @IsString({ message: '권한은 문자열 배열이어야 합니다.' })
  scopes: string[];

  @IsString({ message: '설명은 문자열이어야 합니다.' })
  description: string;
}
