// apps/notification/src/template/controllers/template.controller.ts
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
import { TemplateService } from '../services/template.service';
import {
    CreateTemplateDto,
    UpdateTemplateDto,
    TemplateFilterDto,
    PreviewTemplateDto,
} from '../dto';

@Controller('api/v1/templates')
export class TemplateController {
    constructor(private readonly templateService: TemplateService) { }

    @Get()
    async findAll(@Query(ValidationPipe) filter: TemplateFilterDto) {
        return this.templateService.findAll(filter);
    }

    @Get(':key')
    async findOne(@Param('key') key: string) {
        return this.templateService.findByKey(key);
    }

    @Post()
    async create(@Body(ValidationPipe) dto: CreateTemplateDto) {
        return this.templateService.create(dto);
    }

    @Put(':key')
    async update(
        @Param('key') key: string,
        @Body(ValidationPipe) dto: UpdateTemplateDto,
    ) {
        return this.templateService.update(key, dto);
    }

    @Post(':key/preview')
    async preview(
        @Param('key') key: string,
        @Body(ValidationPipe) dto: PreviewTemplateDto,
    ) {
        return this.templateService.preview(key, dto);
    }
}