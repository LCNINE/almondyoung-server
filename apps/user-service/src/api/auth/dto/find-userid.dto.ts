import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class FindUserIdDto {
  @ApiProperty({
    description: '휴대폰 번호',
    example: '010-1234-5678',
  })
  @IsString({ message: '휴대폰 번호는 문자열이어야 합니다.' })
  phoneNumber: string;
}
