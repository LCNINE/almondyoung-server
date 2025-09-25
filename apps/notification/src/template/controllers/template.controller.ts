import { Controller, Get, Post, Put, Delete, Body, Param, Query, ValidationPipe } from "@nestjs/common";
import { TemplateService } from "../services/template.service";
import { CreateTemplateDto, UpdateTemplateDto, TemplateFilterDto, PreviewTemplateDto } from "../dto";

@Controller("api/v1/templates")
export class TemplateController {
    constructor(private readonly templateService: TemplateService) { }

    // 구체적인 라우트들을 먼저 정의
    @Get("kakao/list")
    async getKakaoTemplateList(): Promise<any> {
        return this.templateService.getKakaoTemplateList();
    }

    @Get("sms/list")
    async getSmsTemplates(): Promise<any> {
        return this.templateService.getSmsTemplates();
    }

    // 기본 CRUD 엔드포인트들
    @Get()
    async findAll(@Query(new ValidationPipe({ transform: true })) filterDto: TemplateFilterDto): Promise<any[]> {
        return this.templateService.findAllTemplates(filterDto);
    }

    @Post()
    async create(@Body(ValidationPipe) createTemplateDto: CreateTemplateDto): Promise<any> {
        return this.templateService.createTemplate(createTemplateDto);
    }

    // 파라미터 라우트들은 마지막에 정의
    @Post("register-kakao/:key")
    async registerKakaoTemplate(@Param("key") templateKey: string, @Body() templateData: any): Promise<any> {
        return this.templateService.registerKakaoTemplate(templateKey, templateData);
    }

    @Post("register-sms/:key")
    async registerSmsTemplate(@Param("key") templateKey: string): Promise<any> {
        return this.templateService.registerSmsTemplate(templateKey);
    }

    @Get("by-id/:id")
    async findOne(@Param("id") id: string): Promise<any> {
        return this.templateService.findTemplateById(id);
    }

    @Put("by-id/:id")
    async update(@Param("id") id: string, @Body() updateTemplateDto: UpdateTemplateDto): Promise<any> {
        return this.templateService.updateTemplate(id, updateTemplateDto);
    }

    @Delete("by-id/:id")
    async remove(@Param("id") id: string): Promise<any> {
        return this.templateService.deleteTemplate(id);
    }

    @Post("preview/:id")
    async previewTemplate(@Param("id") id: string, @Body(ValidationPipe) previewDto: PreviewTemplateDto): Promise<any> {
        return this.templateService.previewTemplate(id, "EMAIL", previewDto);
    }

    @Post(":key/test/:channel")
    async testTemplateWithChannel(
        @Param("key") templateKey: string,
        @Param("channel") channel: string,
        @Body() testDto: any
    ): Promise<any> {
        return this.templateService.previewTemplate(templateKey, channel, testDto);
    }
}
