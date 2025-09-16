// apps/notification/src/template/services/template.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import { templates, Template, NewTemplate } from '../../../database/schemas/notification-schema';
import {
    CreateTemplateDto,
    UpdateTemplateDto,
    TemplateFilterDto,
    PreviewTemplateDto,
} from '../dto';
import { TemplateRendererService } from '../../shared/services/template-renderer.service';
import { ProviderManagerService } from '../../provider/services/provider-manager.service';

@Injectable()
export class TemplateService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        private readonly templateRendererService: TemplateRendererService,
        private readonly providerManagerService: ProviderManagerService,
    ) {}

    async createTemplate(createTemplateDto: CreateTemplateDto): Promise<Template> {
        const newTemplate: NewTemplate = {
            ...createTemplateDto,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const [template] = await this.dbService.insert(templates).values(newTemplate).returning();
        return template;
    }

    async findAllTemplates(filterDto: TemplateFilterDto): Promise<Template[]> {
        let query = this.dbService.select().from(templates);

        if (filterDto.category) {
            query = query.where(eq(templates.category, filterDto.category));
        }

        if (filterDto.supportedChannels && filterDto.supportedChannels.length > 0) {
            // Note: This is a simplified filter. In a real implementation, you might need to use JSON operations
            // depending on your database's JSON support
        }

        return await query;
    }

    async findTemplateById(id: string): Promise<Template> {
        const [template] = await this.dbService
            .select()
            .from(templates)
            .where(eq(templates.id, id));

        if (!template) {
            throw new NotFoundException(`Template with ID ${id} not found`);
        }

        return template;
    }

    async findByKey(key: string): Promise<Template> {
        const [template] = await this.dbService
            .select()
            .from(templates)
            .where(eq(templates.templateKey, key));

        if (!template) {
            throw new NotFoundException(`Template with key ${key} not found`);
        }

        return template;
    }

    async updateTemplate(id: string, updateTemplateDto: UpdateTemplateDto): Promise<Template> {
        const [template] = await this.dbService
            .update(templates)
            .set({ ...updateTemplateDto, updatedAt: new Date() })
            .where(eq(templates.id, id))
            .returning();

        if (!template) {
            throw new NotFoundException(`Template with ID ${id} not found`);
        }

        return template;
    }

    async deleteTemplate(id: string): Promise<void> {
        const result = await this.dbService
            .delete(templates)
            .where(eq(templates.id, id));

        if (result.rowCount === 0) {
            throw new NotFoundException(`Template with ID ${id} not found`);
        }
    }

    async previewTemplate(id: string, previewDto: PreviewTemplateDto): Promise<Record<string, string>> {
        const template = await this.findTemplateById(id);
        const renderedContents: Record<string, string> = {};

        for (const channel of previewDto.channels) {
            const content = this.getChannelTemplateContent(template, channel, previewDto.language);
            if (content) {
                renderedContents[channel] = this.templateRendererService.render(content, previewDto.payload);
            }
        }
        
        return renderedContents;
    }

    getChannelTemplateContent(template: Template, channel: string, language: string): string | undefined {
        const channelUpper = channel.toUpperCase();
        return template.contents?.[channelUpper]?.[language] || template.contents?.[channelUpper]?.['ko'];
    }

    // NHN KakaoTalk Template Management
    async registerKakaoTemplate(templateKey: string): Promise<any> {
        const template = await this.findByKey(templateKey);
        const kakaoProvider = this.providerManagerService.getProvider('nhn-kakao');
        const kakaoContent = template.contents?.['KAKAO'];
        if (!kakaoContent) {
            throw new NotFoundException('KakaoTalk content not found in template');
        }

        // Get the KakaoTalk content for Korean
        const content = kakaoContent['ko'] || Object.values(kakaoContent)[0];
        
        const templateData = {
            templateCode: template.templateKey,
            templateName: template.name,
            templateContent: content,
            templateMessageType: 'BA',
            templateEmphasizeType: 'NONE',
            categoryCode: '999999'
        };

        return await kakaoProvider.registerTemplate(templateData);
    }

    async getKakaoTemplateList(): Promise<any> {
        const kakaoProvider = this.providerManagerService.getProvider('nhn-kakao');
        return await kakaoProvider.getTemplates();
    }

    async getKakaoTemplateDetail(templateCode: string): Promise<any> {
        const kakaoProvider = this.providerManagerService.getProvider('nhn-kakao');
        return await kakaoProvider.getTemplateDetail(templateCode);
    }

    async updateKakaoTemplate(templateKey: string, updateData: any): Promise<any> {
        const template = await this.findByKey(templateKey);
        const kakaoProvider = this.providerManagerService.getProvider('nhn-kakao');
        return await kakaoProvider.updateTemplate(template.templateKey, updateData);
    }

    async deleteKakaoTemplate(templateCode: string): Promise<any> {
        const kakaoProvider = this.providerManagerService.getProvider('nhn-kakao');
        return await kakaoProvider.deleteTemplate(templateCode);
    }

    // Twilio SMS Template Management
    async registerSmsTemplate(templateKey: string): Promise<any> {
        const template = await this.findByKey(templateKey);
        const smsProvider = this.providerManagerService.getProvider('twilio');
        const smsContent = template.contents?.['SMS'];
        if (!smsContent) {
            throw new NotFoundException('SMS content not found in template');
        }

        const content = smsContent['ko'] || Object.values(smsContent)[0];
        
        const templateData = {
            friendlyName: template.name,
            text: content
        };

        return await smsProvider.createTemplate(templateData);
    }

    async getSmsTemplates(): Promise<any> {
        const smsProvider = this.providerManagerService.getProvider('twilio');
        return await smsProvider.getTemplates();
    }

    async getSmsTemplateDetail(templateSid: string): Promise<any> {
        const smsProvider = this.providerManagerService.getProvider('twilio');
        return await smsProvider.getTemplateDetail(templateSid);
    }

    async updateSmsTemplate(templateKey: string, updateData: any): Promise<any> {
        const template = await this.findByKey(templateKey);
        const smsProvider = this.providerManagerService.getProvider('twilio');
        return await smsProvider.updateTemplate(template.templateKey, updateData);
    }

    async deleteSmsTemplate(templateSid: string): Promise<any> {
        const smsProvider = this.providerManagerService.getProvider('twilio');
        return await smsProvider.deleteTemplate(templateSid);
    }

    // NHN 카카오톡 템플릿 등록
    async registerKakaoTemplate(templateKey: string, templateData: any): Promise<any> {
        const template = await this.findByKey(templateKey);
        
        // NHN API로 템플릿 등록
        const nhnProvider = this.providerManagerService.getProvider('nhn-kakao');
        const result = await nhnProvider.createTemplate(templateData);
        
        // DB에 NHN 템플릿 정보 업데이트
        await this.dbService.update(templates)
            .set({
                nhnTemplateCode: result.templateCode,
                nhnTemplateStatus: 'PENDING',
                nhnTemplateId: result.templateId,
                nhnRegisteredAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(templates.templateKey, templateKey));
        
        return result;
    }

    // NHN 카카오톡 템플릿 목록 조회
    async getKakaoTemplateList(): Promise<any> {
        const nhnProvider = this.providerManagerService.getProvider('nhn-kakao');
        return await nhnProvider.getTemplates();
    }

    // NHN 카카오톿 템플릿 상세 조회
    async getKakaoTemplateDetail(templateCode: string): Promise<any> {
        const nhnProvider = this.providerManagerService.getProvider('nhn-kakao');
        return await nhnProvider.getTemplateDetail(templateCode);
    }

    // NHN 카카오톡 템플릿 수정
    async updateKakaoTemplate(templateKey: string, updateData: any): Promise<any> {
        const template = await this.findByKey(templateKey);
        const nhnProvider = this.providerManagerService.getProvider('nhn-kakao');
        return await nhnProvider.updateTemplate(template.nhnTemplateCode, updateData);
    }

    // NHN 카카오톡 템플릿 삭제
    async deleteKakaoTemplate(templateCode: string): Promise<any> {
        const nhnProvider = this.providerManagerService.getProvider('nhn-kakao');
        return await nhnProvider.deleteTemplate(templateCode);
    }

    // NHN 카카오톡 템플릿 승인 상태 업데이트
    async updateKakaoTemplateStatus(templateKey: string, status: string): Promise<void> {
        await this.dbService.update(templates)
            .set({
                nhnTemplateStatus: status,
                updatedAt: new Date(),
            })
            .where(eq(templates.templateKey, templateKey));
    }
}
