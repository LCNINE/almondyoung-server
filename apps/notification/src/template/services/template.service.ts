// apps/notification/src/template/services/template.service.ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { eq } from 'drizzle-orm';
import { notificationTables, templates } from '../../../database/schemas/notification-schema';
import { CreateTemplateDto, UpdateTemplateDto, TemplateFilterDto, PreviewTemplateDto } from '../dto';
import { NHNTemplateService } from './nhn-template.service';

interface Template {
    templateId: string;
    templateKey: string;
    name: string;
    category: string;
    contents: any;
    variablesSchema: any;
    version: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

interface NewTemplate {
    templateKey: string;
    name: string;
    category: string;
    contents: any;
    variablesSchema: any;
    isActive: boolean;
}

@Injectable()
export class TemplateService {
    private readonly logger = new Logger(TemplateService.name);

    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        private readonly nhnTemplateService: NHNTemplateService,
    ) {}

    async createTemplate(createTemplateDto: CreateTemplateDto): Promise<any> {
        const db = this.dbService.db;

        // 1. DB에 템플릿 저장
        const [inserted] = await db
            .insert(templates)
            .values({
                templateKey: createTemplateDto.templateKey,
                name: createTemplateDto.name,
                category: createTemplateDto.category,
                contents: createTemplateDto.contents,
                variablesSchema: createTemplateDto.variablesSchema,
                version: 1,
                isActive: true,
                metadata: createTemplateDto.metadata || {},
                // 카카오 템플릿 초기값 (NHN 등록 전)
                kakaoTemplateCode: createTemplateDto.kakaoTemplateConfig?.templateCode,
                kakaoTemplateStatus: 'PENDING',
            })
            .returning();

        // 2. 카카오 템플릿이 있으면 NHN에 등록
        if (createTemplateDto.kakaoTemplateConfig) {
            try {
                const kakaoConfig = createTemplateDto.kakaoTemplateConfig;
                
                // KAKAO 채널의 contents에서 본문 추출
                const contents = createTemplateDto.contents as any;
                const kakaoContent = contents?.ko?.KAKAO || contents?.en?.KAKAO;
                const templateContent = kakaoConfig.templateContent || kakaoContent?.body || '';

                // NHN API 요청 형식으로 변환
                const nhnTemplateData = {
                    templateCode: kakaoConfig.templateCode,
                    templateName: kakaoConfig.templateName,
                    templateContent: templateContent,
                    templateMessageType: 'BA', // 기본형 (나중에 확장 가능)
                    templateEmphasizeType: 'NONE',
                    categoryCode: '999999', // 기타 카테고리
                };

                // NHN에 템플릿 등록
                const nhnResponse = await this.nhnTemplateService.createTemplate(nhnTemplateData);

                // NHN 응답 확인
                if (!nhnResponse.header?.isSuccessful) {
                    throw new Error(nhnResponse.header?.resultMessage || 'NHN 템플릿 등록 실패');
                }

                // 등록 후 즉시 상태 동기화 (NHN에서 실제 상태 조회)
                const syncResult = await this.nhnTemplateService.syncTemplateStatus(kakaoConfig.templateCode);

                // DB 업데이트: NHN 등록 결과 및 상태 반영
                await db
                    .update(templates)
                    .set({
                        kakaoTemplateCode: kakaoConfig.templateCode,
                        kakaoTemplateStatus: syncResult.status, // NHN에서 조회한 실제 상태
                        providerTemplateId: syncResult.kakaoTemplateCode || kakaoConfig.templateCode,
                        lastSyncedAt: new Date(),
                        lastSyncError: syncResult.error || null,
                        updatedAt: new Date(),
                    })
                    .where(eq(templates.templateId, inserted.templateId));

                this.logger.log(`Kakao template registered to NHN: ${kakaoConfig.templateCode}, status: ${syncResult.status}`);
            } catch (error: any) {
                this.logger.error(`Failed to register kakao template to NHN: ${error.message}`, error.stack);
                
                // 에러 저장
                await db
                    .update(templates)
                    .set({
                        kakaoTemplateStatus: 'PENDING',
                        lastSyncError: error.message || 'NHN 템플릿 등록 실패',
                        updatedAt: new Date(),
                    })
                    .where(eq(templates.templateId, inserted.templateId));
                
                // 템플릿은 생성되었지만 NHN 등록은 실패한 경우이므로 에러를 던지지 않고 경고만
                this.logger.warn(`Template created but NHN registration failed: ${inserted.templateId}`);
            }
        }

        // 3. 최종 템플릿 조회 및 반환
        const finalTemplate = await db.query.templates.findFirst({
            where: eq(templates.templateId, inserted.templateId),
        });

        return this.formatTemplateResponse(finalTemplate!);
    }

    async findAllTemplates(filterDto: TemplateFilterDto): Promise<Template[]> {
        // 간단한 구현
        return [];
    }

    async findTemplateById(id: string): Promise<any> {
        const db = this.dbService.db;
        
        const template = await db.query.templates.findFirst({
            where: eq(templates.templateId, id),
        });

        if (!template) {
            throw new NotFoundException(`Template with ID ${id} not found`);
        }

        return this.formatTemplateResponse(template);
    }

    async findById(id: string): Promise<any> {
        return this.findTemplateById(id);
    }

    async findByKey(key: string): Promise<Template> {
        // 간단한 구현
        throw new NotFoundException(`Template with key ${key} not found`);
    }

    async findTemplateByKey(key: string): Promise<Template> {
        // 간단한 구현
        throw new NotFoundException(`Template with key ${key} not found`);
    }

    async updateTemplate(id: string, updateTemplateDto: UpdateTemplateDto): Promise<any> {
        const db = this.dbService.db;
        
        const existing = await db.query.templates.findFirst({
            where: eq(templates.templateId, id),
        });

        if (!existing) {
            throw new NotFoundException(`Template with ID ${id} not found`);
        }

        // 1. DB 업데이트
        const updateData: any = {
            updatedAt: new Date(),
        };

        if (updateTemplateDto.name) updateData.name = updateTemplateDto.name;
        if (updateTemplateDto.category) updateData.category = updateTemplateDto.category;
        if (updateTemplateDto.contents) updateData.contents = updateTemplateDto.contents;
        if (updateTemplateDto.variablesSchema) updateData.variablesSchema = updateTemplateDto.variablesSchema;
        if (updateTemplateDto.metadata !== undefined) updateData.metadata = updateTemplateDto.metadata;
        if ('isActive' in updateTemplateDto && updateTemplateDto.isActive !== undefined) {
            updateData.isActive = updateTemplateDto.isActive;
        }

        await db
            .update(templates)
            .set(updateData)
            .where(eq(templates.templateId, id));

        // 2. 카카오 템플릿이 있고, 기존에 NHN에 등록되어 있으면 NHN에도 수정
        if (updateTemplateDto.kakaoTemplateConfig && existing.kakaoTemplateCode) {
            try {
                const kakaoConfig = updateTemplateDto.kakaoTemplateConfig;
                
                // KAKAO 채널의 contents에서 본문 추출
                const contents = updateTemplateDto.contents || existing.contents as any;
                const kakaoContent = contents?.ko?.KAKAO || contents?.en?.KAKAO;
                const existingContents = existing.contents as any;
                const templateContent = kakaoConfig.templateContent || kakaoContent?.body || existingContents?.ko?.KAKAO?.body || '';

                // NHN API 요청 형식으로 변환
                const nhnTemplateData = {
                    templateName: kakaoConfig.templateName || existing.name,
                    templateContent: templateContent,
                    templateMessageType: 'BA',
                    templateEmphasizeType: 'NONE',
                };

                // NHN에 템플릿 수정
                const nhnResponse = await this.nhnTemplateService.updateTemplate(existing.kakaoTemplateCode, nhnTemplateData);

                // NHN 응답 확인
                if (!nhnResponse.header?.isSuccessful) {
                    throw new Error(nhnResponse.header?.resultMessage || 'NHN 템플릿 수정 실패');
                }

                // 수정 후 즉시 상태 동기화 (NHN에서 실제 상태 조회)
                const syncResult = await this.nhnTemplateService.syncTemplateStatus(existing.kakaoTemplateCode);

                // DB 업데이트: 수정 완료 및 상태 반영
                await db
                    .update(templates)
                    .set({
                        kakaoTemplateStatus: syncResult.status, // NHN에서 조회한 실제 상태
                        lastSyncedAt: new Date(),
                        lastSyncError: syncResult.error || null,
                        updatedAt: new Date(),
                    })
                    .where(eq(templates.templateId, id));

                this.logger.log(`Kakao template updated in NHN: ${existing.kakaoTemplateCode}, status: ${syncResult.status}`);
            } catch (error: any) {
                this.logger.error(`Failed to update kakao template in NHN: ${error.message}`, error.stack);
                
                // 에러 저장
                await db
                    .update(templates)
                    .set({
                        lastSyncError: error.message || 'NHN 템플릿 수정 실패',
                        updatedAt: new Date(),
                    })
                    .where(eq(templates.templateId, id));
                
                // 템플릿은 수정되었지만 NHN 수정은 실패한 경우이므로 에러를 던지지 않고 경고만
                this.logger.warn(`Template updated but NHN update failed: ${id}`);
            }
        }

        // 3. 최종 템플릿 조회 및 반환
        const updated = await db.query.templates.findFirst({
            where: eq(templates.templateId, id),
        });

        return this.formatTemplateResponse(updated!);
    }

    async deleteTemplate(id: string): Promise<void> {
        // 간단한 구현
        throw new NotFoundException(`Template with ID ${id} not found`);
    }


    // 기본 템플릿 메서드들
    async getChannelTemplateContent(template: Template, channel: string, language: string): Promise<string> {
        const content = template.contents?.[channel];
        if (!content) return '';
        
        const langContent = content[language];
        return langContent?.body || '';
    }

    // 추가 메서드들
    async getKakaoTemplateList(): Promise<any> {
        return [];
    }

    async getSmsTemplates(): Promise<any> {
        return [];
    }

    async registerKakaoTemplate(templateKey: string, templateData: any): Promise<any> {
        return { success: true, templateKey };
    }

    async registerSmsTemplate(templateKey: string): Promise<any> {
        return { success: true, templateKey };
    }

    async previewTemplate(templateKey: string, channel: string, testData?: any): Promise<any> {
        const template = await this.findTemplateByKey(templateKey);
        if (!template) {
            throw new NotFoundException(`Template with key ${templateKey} not found`);
        }

        // 간단한 미리보기 구현
        return {
            templateKey,
            channel,
            preview: template.contents[channel] || {},
            testData: testData || {}
        };
    }

    /**
     * 카카오 템플릿 상태 동기화
     * NHN 콘솔에서 템플릿 상태를 조회하여 DB에 업데이트
     */
    async syncKakaoTemplateStatus(templateId: string): Promise<any> {
        const db = this.dbService.db;
        
        const template = await db.query.templates.findFirst({
            where: eq(templates.templateId, templateId),
        });

        if (!template) {
            throw new NotFoundException(`Template with ID ${templateId} not found`);
        }

        if (!template.kakaoTemplateCode) {
            throw new NotFoundException(`Template ${templateId} does not have kakaoTemplateCode`);
        }

        try {
            const syncResult = await this.nhnTemplateService.syncTemplateStatus(template.kakaoTemplateCode);
            
            // DB 업데이트
            await db
                .update(templates)
                .set({
                    kakaoTemplateStatus: syncResult.status,
                    providerTemplateId: syncResult.kakaoTemplateCode || template.providerTemplateId,
                    lastSyncedAt: new Date(),
                    lastSyncError: syncResult.error || null,
                    updatedAt: new Date(),
                })
                .where(eq(templates.templateId, templateId));

            const updated = await db.query.templates.findFirst({
                where: eq(templates.templateId, templateId),
            });

            return {
                templateId: updated!.templateId,
                kakaoTemplateCode: updated!.kakaoTemplateCode,
                kakaoTemplateStatus: updated!.kakaoTemplateStatus,
                statusName: syncResult.statusName,
                lastSyncedAt: updated!.lastSyncedAt,
                lastSyncError: updated!.lastSyncError,
            };
        } catch (error: any) {
            this.logger.error(`Failed to sync kakao template status: ${error.message}`, error.stack);
            
            // 에러도 DB에 저장
            await db
                .update(templates)
                .set({
                    lastSyncedAt: new Date(),
                    lastSyncError: error.message,
                    updatedAt: new Date(),
                })
                .where(eq(templates.templateId, templateId));

            throw error;
        }
    }

    /**
     * 템플릿 응답 포맷팅 (kakaoTemplateConfig 포함)
     */
    private formatTemplateResponse(template: any): any {
        const response: any = {
            templateId: template.templateId,
            templateKey: template.templateKey,
            name: template.name,
            category: template.category,
            contents: template.contents,
            variablesSchema: template.variablesSchema,
            version: template.version,
            isActive: template.isActive,
            metadata: template.metadata,
            createdAt: template.createdAt,
            updatedAt: template.updatedAt,
        };

        // 카카오 템플릿 정보가 있으면 포함
        if (template.kakaoTemplateCode) {
            response.kakaoTemplateConfig = {
                templateCode: template.kakaoTemplateCode,
                templateName: template.name, // 또는 별도 필드가 있으면 그것 사용
                templateContent: template.contents?.ko?.KAKAO?.body || template.contents?.en?.KAKAO?.body || '',
                providerTemplateId: template.providerTemplateId,
                status: template.kakaoTemplateStatus || 'PENDING',
                lastSyncedAt: template.lastSyncedAt?.toISOString(),
                lastSyncError: template.lastSyncError,
            };
        }

        return response;
    }
}
