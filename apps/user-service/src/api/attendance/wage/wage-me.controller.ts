import { RequirePermission, type JwtPayload } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { MyWage } from '@packages/domain-types/attendance-wage';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import { MyWageQueryDto } from './dto/wage-settlement.dto';
import { WageSettlementService } from './wage-settlement.service';
import { ServedTenantData } from '../../../tenancy/served-tenant.guard';

/** 본인 급여 — 토큰의 사용자만 본다(경로·쿼리에 사람을 고르는 값이 없다). */
@ServedTenantData()
@Controller('attendance/wage')
@UseGuards(ActiveAttendanceStaffGuard)
export class WageMeController {
  constructor(private readonly service: WageSettlementService) {}

  @Get('me')
  @RequirePermission('attendance.own.write')
  mine(@CurrentUser() user: JwtPayload, @Query() query: MyWageQueryDto): Promise<MyWage> {
    return this.service.mine(user.id, query.paydayMonth);
  }
}
