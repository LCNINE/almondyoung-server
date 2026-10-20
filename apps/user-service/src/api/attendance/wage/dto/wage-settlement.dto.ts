import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class WagePeriodQueryDto {
  @IsUUID()
  groupId: string;

  @Matches(MONTH, { message: '지급 달을 YYYY-MM 형식으로 골라 주세요.' })
  paydayMonth: string;
}

export class MyWageQueryDto {
  @Matches(MONTH, { message: '지급 달을 YYYY-MM 형식으로 골라 주세요.' })
  paydayMonth: string;
}

export class SettlementListQueryDto {
  @IsUUID()
  groupId: string;
}

export class DecideOvertimeDto {
  @IsIn(['recognized', 'rejected'])
  status: 'recognized' | 'rejected';

  @IsInt()
  @Min(0)
  @Max(24 * 60)
  recognizedMinutes: number;

  /** 판정할 때 화면에 보인 초과 시간 — 나중에 기록이 바뀌어도 무엇을 보고 판정했는지 남긴다. */
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  recordedMinutes: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class DecideAbsenceDto {
  @IsIn(['excused_paid', 'excused_unpaid', 'absent'])
  kind: 'excused_paid' | 'excused_unpaid' | 'absent';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class ConfirmSettlementDto {
  @IsUUID()
  groupId: string;

  @Matches(MONTH, { message: '지급 달을 YYYY-MM 형식으로 골라 주세요.' })
  paydayMonth: string;
}

export class ReopenSettlementDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}
