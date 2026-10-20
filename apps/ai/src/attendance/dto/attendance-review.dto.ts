import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class AttendanceReviewDto {
  @IsUUID()
  requestId: string;

  @IsUUID()
  userId: string;

  @IsInt()
  @Min(1)
  version: number;

  @IsString()
  @MaxLength(5000)
  reason: string;

  @IsOptional()
  @IsString()
  checkIn?: string;

  @IsOptional()
  @IsString()
  checkOut?: string;

  @IsArray()
  @ArrayMaxSize(3)
  @IsUUID(undefined, { each: true })
  fileIds: string[];
}
