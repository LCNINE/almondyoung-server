import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TemplateService } from "../services/template.service";

@ApiTags('templates')
@Controller("api/v1/templates")
export class TemplateChannelController {
    constructor(private readonly templateService: TemplateService) { }

    @Get("kakao/list")
    @ApiOperation({ summary: 'Kakao 템플릿 목록 조회', description: 'Kakao 알림톡 템플릿 목록을 조회합니다.' })
    @ApiResponse({ status: 200, description: 'Kakao 템플릿 목록 조회 성공' })
    async getKakaoTemplateList() {
        return this.templateService.getKakaoTemplateList();
    }

    @Get("sms/list")
    @ApiOperation({ summary: 'SMS 템플릿 목록 조회', description: 'SMS 템플릿 목록을 조회합니다.' })
    @ApiResponse({ status: 200, description: 'SMS 템플릿 목록 조회 성공' })
    async getSmsTemplates() {
        return this.templateService.getSmsTemplates();
    }
}
