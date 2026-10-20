import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreatePayGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @IsIn(['hourly', 'salaried'])
  payBasis: 'hourly' | 'salaried';

  @IsInt()
  @Min(1)
  @Max(31)
  payday: number;

  @IsInt()
  @Min(0)
  @Max(31)
  periodCloseDay: number;

  @IsIn([0, 1])
  payMonthOffset: 0 | 1;

  /** 처음 계산 규칙. 없으면 기본 규칙(5인 이상 여부만 이 값으로). */
  @IsOptional()
  @IsObject()
  rules?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  rulesEffectiveFrom?: string;
}

export class UpdatePayGroupDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  payday?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  periodCloseDay?: number;

  @IsOptional()
  @IsIn([0, 1])
  payMonthOffset?: 0 | 1;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreatePayPolicyDto {
  @IsString()
  effectiveFrom: string;

  @IsObject()
  rules: Record<string, unknown>;
}

export class SaveWorkerDto {
  @IsUUID()
  groupId: string;

  @IsOptional()
  @IsString()
  hireDate?: string | null;

  @IsOptional()
  @IsString()
  leaveDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  label?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  /** 이미 명단에 있으면 필수 — 화면이 읽은 버전. */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class CreateWageRateDto {
  @IsString()
  effectiveFrom: string;

  @IsInt()
  @Min(1)
  @Max(1000000)
  hourlyWage: number;
}

export class ScheduleDayDto {
  @IsIn([1, 2, 3, 4, 5, 6, 7])
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;

  @IsString()
  start: string;

  @IsString()
  end: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  breakMinutes?: number;
}

export class CreateWorkScheduleDto {
  @IsString()
  effectiveFrom: string;

  @IsOptional()
  @IsString()
  effectiveTo?: string | null;

  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days: ScheduleDayDto[];
}

export class CreateMinimumWageDto {
  @IsString()
  effectiveFrom: string;

  @IsInt()
  @Min(1)
  @Max(1000000)
  hourlyWage: number;
}

export class UpdateWageRateDto {
  @IsOptional()
  @IsString()
  effectiveFrom?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  hourlyWage?: number;
}

export class UpdateWorkScheduleDto {
  @IsOptional()
  @IsString()
  effectiveFrom?: string;

  /** null 이면 종료일을 지운다(다음 시간표가 시작될 때까지). */
  @IsOptional()
  @IsString()
  effectiveTo?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days?: ScheduleDayDto[];
}

export class UpdatePayPolicyDto {
  @IsOptional()
  @IsString()
  effectiveFrom?: string;

  @IsOptional()
  @IsObject()
  rules?: Record<string, unknown>;
}

export class UpdateMinimumWageDto {
  @IsInt()
  @Min(1)
  @Max(1000000)
  hourlyWage: number;
}
