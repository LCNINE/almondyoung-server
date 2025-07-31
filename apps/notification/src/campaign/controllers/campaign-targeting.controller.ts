// apps/notification/src/campaign/controllers/campaign-targeting.controller.ts
import {
    Controller,
    Post,
    Body,
    Param,
    ValidationPipe,
} from '@nestjs/common';
import { CampaignTargetingService } from '../services/campaign-targeting.service';
import { TargetGroupDto } from '../dto/target-group.dto';
import { UploadExcelDto } from '../dto/upload-excel.dto';

@Controller('api/v1/campaigns/:campaignId/targeting')
export class CampaignTargetingController {
    constructor(
        private readonly targetingService: CampaignTargetingService,
    ) { }

    @Post('excel')
    async uploadExcel(
        @Param('campaignId') campaignId: string,
        @Body(ValidationPipe) dto: UploadExcelDto,
    ) {
        const targetGroup: TargetGroupDto = {
            name: dto.name,
            type: 'excel',
            userList: dto.userIds,
        };

        await this.targetingService.createTargetGroups(campaignId, [targetGroup]);

        return {
            message: 'Target group created',
            count: dto.userIds.length,
        };
    }

    @Post('preview')
    async previewTargeting(
        @Param('campaignId') campaignId: string,
        @Body(ValidationPipe) dto: {
            groups: TargetGroupDto[];
        },
    ) {
        return this.targetingService.previewTargeting(dto.groups);
    }
}