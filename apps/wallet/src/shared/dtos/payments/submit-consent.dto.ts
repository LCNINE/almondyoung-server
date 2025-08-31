import { IsString } from 'class-validator';

export class SubmitConsentDto {
  @IsString()
  memberId: string;

  @IsString()
  filename: string;

  file: Buffer;
}
