import { Controller, Get } from "@nestjs/common";
import { TemplateService } from "../services/template.service";

@Controller("api/v1/templates")
export class TemplateChannelController {
    constructor(private readonly templateService: TemplateService) { }

    @Get("kakao/list")
    async getKakaoTemplateList() {
        return this.templateService.getKakaoTemplateList();
    }

    @Get("sms/list")
    async getSmsTemplates() {
        return this.templateService.getSmsTemplates();
    }
}
