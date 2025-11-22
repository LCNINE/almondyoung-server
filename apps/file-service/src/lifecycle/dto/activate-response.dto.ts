import { ApiProperty } from '@nestjs/swagger';

export class ActivateResponseDto {
  @ApiProperty({
    description: 'Success status',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'File ID',
    example: '01933e7a-1234-7890-abcd-0123456789ab',
  })
  fileId: string;

  @ApiProperty({
    description: 'Current status',
    example: 'active',
  })
  status: string;

  @ApiProperty({
    description: 'Message',
    example: 'File activated successfully',
    required: false,
  })
  message?: string;
}

export class DeleteResponseDto {
  @ApiProperty({
    description: 'Success status',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Message',
    example: 'File deleted successfully',
  })
  message: string;
}

