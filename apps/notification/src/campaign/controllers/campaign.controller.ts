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