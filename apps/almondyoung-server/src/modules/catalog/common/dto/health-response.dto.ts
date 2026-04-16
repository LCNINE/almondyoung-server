import { ApiProperty } from '@nestjs/swagger';

export class PimHealthResponseDto {
  @ApiProperty({
    description: '서비스 상태',
    example: 'ok',
  })
  status: string;

  @ApiProperty({
    description: '서비스 이름',
    example: 'PIM (Product Information Management)',
  })
  service: string;
}
