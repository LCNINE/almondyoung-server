import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** 한 번에 물을 수 있는 안내 수. 현황 화면 한 장에 실리는 건수보다 넉넉하다 */
export const AUTO_SEND_LOOKUP_MAX = 300;

export class AttemptNoticeRefDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  invoiceId: string;

  @IsInt()
  @Min(1)
  @Max(10)
  attemptNo: number;
}

export class TerminationNoticeRefDto {
  @IsUUID()
  contractId: string;
}

/** 멤버십 요금 안내가 나갔는지 묻는다. 묻는 쪽은 키 형식을 모르고 인보이스·계약 id 만 넘긴다 */
export class LookupMembershipNoticesDto {
  @ApiPropertyOptional({ type: [AttemptNoticeRefDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AUTO_SEND_LOOKUP_MAX)
  @ValidateNested({ each: true })
  @Type(() => AttemptNoticeRefDto)
  attempts?: AttemptNoticeRefDto[];

  @ApiPropertyOptional({ type: [TerminationNoticeRefDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AUTO_SEND_LOOKUP_MAX)
  @ValidateNested({ each: true })
  @Type(() => TerminationNoticeRefDto)
  terminations?: TerminationNoticeRefDto[];
}
