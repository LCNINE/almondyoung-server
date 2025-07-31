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

@Injectable()
export class TemplateService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        private readonly rendererService: TemplateRendererService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async findAll(filter: TemplateFilterDto): Promise<Template[]> {
        const conditions: any[] = [];

        if (filter.isActive !== undefined) {
            conditions.push(eq(templates.isActive, filter.isActive));
        }

        return this.db.query.templates.findMany({
            where: conditions.length > 0 ? and(...conditions) : undefined,
        });
    }

    async findByKey(key: string): Promise<Template> {
        const template = await this.db.query.templates.findFirst({
            where: and(eq(templates.templateKey, key), eq(templates.isActive, true))
        });

        if (!template) {
            throw new NotFoundException(`Template with key ${key} not found`);
        }

        return template;
    }

    async findById(id: string): Promise<Template> {
        const template = await this.db.query.templates.findFirst({
            where: eq(templates.templateId, id)
        });

        if (!template) {
            throw new NotFoundException(`Template with id ${id} not found`);
        }

        return template;
    }

    async create(dto: CreateTemplateDto): Promise<Template> {
        const newTemplate: NewTemplate = {
            templateKey: dto.templateKey,
            name: dto.name,
            category: dto.category || 'MARKETING',
            contents: dto.contents, // { EMAIL: { ko: {...}, en: {...} }, KAKAO: {...} }
            variablesSchema: dto.variablesSchema,
            version: 1,
            isActive: true,
            metadata: dto.metadata,
        };

        const [result] = await this.db
            .insert(templates)
            .values(newTemplate)
            .returning();

        return result;
    }

    async update(key: string, dto: UpdateTemplateDto): Promise<Template> {
        const existing = await this.findByKey(key);

        // Deactivate current version
        await this.db
            .update(templates)
            .set({ isActive: false })
            .where(eq(templates.templateId, existing.templateId));

        // Create new version
        const newTemplate: NewTemplate = {
            ...existing,
            ...dto,
            templateId: undefined,
            version: existing.version + 1,
            isActive: true,
            createdAt: undefined,
            updatedAt: undefined,
        };

        const [result] = await this.db
            .insert(templates)
            .values(newTemplate)
            .returning();

        return result;
    }

    async preview(key: string, dto: PreviewTemplateDto) {
        const template = await this.findByKey(key);

        // 선택된 채널들에 대해서만 렌더링
        const renderedContents: Record<string, any> = {};

        for (const channel of dto.channels) {
            const contents = template.contents as Record<string, any>;
            const channelContent = contents[channel];
            if (!channelContent) continue;

            const langContent = channelContent[dto.language] || channelContent['ko'];
            if (!langContent) continue;

            const rendered = await this.rendererService.render(
                langContent.body,
                dto.payload,
            );

            renderedContents[channel] = {
                subject: langContent.subject
                    ? await this.rendererService.render(langContent.subject, dto.payload)
                    : undefined,
                body: rendered,
                metadata: langContent.metadata,
            };
        }

        return renderedContents;
    }
}