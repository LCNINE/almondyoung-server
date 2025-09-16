// apps/notification/src/campaign/controllers/campaign.controller.ts
import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Param,
    Query,
    ValidationPipe,
} from '@nestjs/common';
import { CampaignService } from '../services/campaign.service';
import {
    CreateCampaignDto,
    UpdateCampaignDto,
    CampaignFilterDto,
} from '../dto';

@Controller('api/v1/campaigns')
export class CampaignController {
    constructor(private readonly campaignService: CampaignService) { }

    @Get()
    async findAll(@Query(ValidationPipe) filter: CampaignFilterDto) {
        return this.campaignService.findAll(filter);
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        return this.campaignService.findById(id);
    }

    @Post()
    async create(@Body(ValidationPipe) dto: CreateCampaignDto) {
        return this.campaignService.create(dto);
    }

    @Put(':id')
    async update(
        @Param('id') id: string,
        @Body(ValidationPipe) dto: UpdateCampaignDto,
    ) {
        return this.campaignService.update(id, dto);
    }

    @Post(':id/approve')
    async approve(
        @Param('id') id: string,
        @Body() dto: { approvedBy: string },
    ) {
        return this.campaignService.approve(id, dto.approvedBy);
    }

    @Post(':id/send')
    async send(@Param('id') id: string) {
        return this.campaignService.send(id);
    }

    @Post(':id/cancel')
    async cancel(@Param('id') id: string) {
        return this.campaignService.cancel(id);
    }

    @Get(':id/stats')
    async getStats(@Param('id') id: string) {
        return this.campaignService.getStats(id);
    }
}
    // 채널별 콘텐츠 관리 엔드포인트들
    @Post(':id/channels/:channel/content')
    async setChannelContent(
        @Param('id') campaignId: string,
        @Param('channel') channel: string,
        @Body() content: any
    ) {
        return this.campaignService.setChannelContent(campaignId, channel, content);
    }

    @Get(':id/channels/:channel/content')
    async getChannelContent(
        @Param('id') campaignId: string,
        @Param('channel') channel: string
    ) {
        return this.campaignService.getChannelContent(campaignId, channel);
    }

    @Post(':id/preview/:channel')
    async previewChannelContent(
        @Param('id') campaignId: string,
        @Param('channel') channel: string,
        @Body() payload: any
    ) {
        return this.campaignService.previewChannelContent(campaignId, channel, payload);
    }

    // 타겟 그룹 관리 엔드포인트들
    @Post(':id/target-groups')
    async addTargetGroup(
        @Param('id') campaignId: string,
        @Body() targetGroup: any
    ) {
        return this.campaignService.addTargetGroup(campaignId, targetGroup);
    }

    @Get(':id/target-groups')
    async getTargetGroups(@Param('id') campaignId: string) {
        return this.campaignService.getTargetGroups(campaignId);
    }

    @Post(':id/target-groups/:groupId/preview')
    async previewTargetGroup(
        @Param('id') campaignId: string,
        @Param('groupId') groupId: string
    ) {
        return this.campaignService.previewTargetGroup(campaignId, groupId);
    }
}
