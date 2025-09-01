import { AuthorizationGuard, RequireScopes } from '@app/roles';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../commons/guards/jwt-auth.guard';
import { UpdateBusinessLicenseDtoWithReviewCommentAndStatus } from '../../business-licenses/dto/update-business-license.dto';
import { BusinessLicensesService } from './business-licenses.service';
import { BusinessLicenseQueryDto } from './dto/pagination-query-dto';

@ApiTags('사업자 등록 관리')
@ApiBearerAuth('access-token')
@Controller('admin/business-licenses')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class BusinessLicensesController {
  constructor(
    private readonly businessLicensesService: BusinessLicensesService,
  ) {}
  //  5. 사업자 등록 정보 삭제 기능

  // 사업자 등록 정보 전체 조회 기능 (Pagenation, Search, Sort, Filter)
  @Get()
  @RequireScopes(['master'])
  async getBusinessLicenses(
    @Query() businessLicenseQueryDto: BusinessLicenseQueryDto,
  ) {
    return this.businessLicensesService.getBusinessLicenses({
      businessLicenseQueryDto,
    });
  }

  // 사업자 등록 정보 상세 조회 기능
  @Get(':id')
  @RequireScopes(['master'])
  async getBusinessLicenseById(@Param('id') id: string) {
    return this.businessLicensesService.getBusinessLicenseByBusinessLicenseId(
      id,
    );
  }

  @Put(':id')
  @RequireScopes(['master'])
  async updateBusinessLicenseById(
    @Param('id') id: string,
    @Body()
    updateBusinessLicenseDto: UpdateBusinessLicenseDtoWithReviewCommentAndStatus,
  ) {
    const businessLicenseId = id;

    return this.businessLicensesService.updateBusinessLicenseByBusinessLicenseId(
      businessLicenseId,
      updateBusinessLicenseDto,
    );
  }

  @Delete(':id')
  @RequireScopes(['master'])
  async deleteBusinessLicenseById(@Param('id') id: string) {
    return this.businessLicensesService.deleteBusinessLicenseById(id);
  }
}
