import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { ApplyCsLabelDto } from '../dto/cs-label.dto';
import { CsLabelsService } from '../services/cs-labels.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('CS Case Labels')
@Controller('cs-cases/:caseId/labels')
export class CsCaseLabelsController {
  constructor(private readonly service: CsLabelsService) {}

  @Post()
  @ApiOperation({ summary: 'CS Case에 라벨 적용' })
  @ApiParam({ name: 'caseId' })
  apply(@Param('caseId') caseId: string, @Body() dto: ApplyCsLabelDto, @User() user: AuthenticatedUser) {
    return this.service.applyLabel(caseId, dto.labelId, this.getUserId(user));
  }

  @Delete(':labelId')
  @ApiOperation({ summary: 'CS Case에서 라벨 제거' })
  @ApiParam({ name: 'caseId' })
  @ApiParam({ name: 'labelId' })
  remove(@Param('caseId') caseId: string, @Param('labelId') labelId: string, @User() user: AuthenticatedUser) {
    return this.service.removeLabel(caseId, labelId, this.getUserId(user));
  }

  private getUserId(user: AuthenticatedUser): string {
    const id = user?.id ?? user?.userId ?? user?.sub;
    if (!id) throw new Error('Authenticated user id missing');
    return id;
  }
}
