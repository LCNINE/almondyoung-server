import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetCheckedDto {
  @ApiProperty()
  @IsBoolean()
  checked: boolean;
}
