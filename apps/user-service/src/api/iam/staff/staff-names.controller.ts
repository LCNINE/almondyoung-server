import { RequirePermission } from '@app/authorization';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentIamActor, type IamActor } from '../iam-actor';
import { StaffNameDto, StaffNamesQueryDto } from './dto/staff-names.dto';
import { StaffNamesService } from './staff-names.service';

@ApiTags('Admin/Staff')
@ApiBearerAuth('access-token')
@Controller('admin/staff')
export class StaffNamesController {
  constructor(private readonly service: StaffNamesService) {}

  @ApiOperation({ summary: '직원 id 묶음의 이름 — 요청자 테넌트의 지금 직원만, 나머지 id 는 빠진다' })
  @ApiOkResponse({ type: [StaffNameDto] })
  @RequirePermission('iam.staff_name.read')
  @Get('names')
  names(@CurrentIamActor() actor: IamActor, @Query() query: StaffNamesQueryDto): Promise<StaffNameDto[]> {
    return this.service.namesOf(actor, query.ids);
  }
}
