import { ApiProperty } from '@nestjs/swagger';

export class LookupResponseDto {
  @ApiProperty({
    description: '전화번호',
    type: String,
  })
  phoneNumber: string;

  @ApiProperty({
    description: '유효한 전화번호 여부',
    type: Boolean,
  })
  valid: boolean;
}
