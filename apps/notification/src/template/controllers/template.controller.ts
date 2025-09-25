import { Controller, Get, Post, Put, Delete, Body, Param, Query, ValidationPipe } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from "@nestjs/swagger";
import { TemplateService } from "../services/template.service";
import { CreateTemplateDto, UpdateTemplateDto, TemplateFilterDto, PreviewTemplateDto } from "../dto";

@ApiTags('templates')
@Controller("api/v1/templates")
export class TemplateController {
    constructor(private readonly templateService: TemplateService) { }

    // 구체적인 라우트들을 먼저 정의
    @Get("kakao/list")
    @ApiOperation({ summary: '카카오 템플릿 목록 조회', description: 'NHN 카카오 비즈메시지 템플릿 목록을 조회합니다.' })
    @ApiResponse({ status: 200, description: '카카오 템플릿 목록 조회 성공' })
    @ApiResponse({ status: 500, description: '서버 오류' })
    async getKakaoTemplateList(): Promise<any> {
        return this.templateService.getKakaoTemplateList();
    }

    @Get("sms/list")
    @ApiOperation({ summary: 'SMS 템플릿 목록 조회', description: 'SMS 템플릿 목록을 조회합니다.' })
    @ApiResponse({ status: 200, description: 'SMS 템플릿 목록 조회 성공' })
    @ApiResponse({ status: 500, description: '서버 오류' })
    async getSmsTemplates(): Promise<any> {
        return this.templateService.getSmsTemplates();
    }

    // 기본 CRUD 엔드포인트들
    @Get()
    @ApiOperation({ summary: '템플릿 목록 조회', description: '필터 조건에 따라 템플릿 목록을 조회합니다.' })
    @ApiQuery({ name: 'isActive', required: false, type: Boolean, description: '활성화 상태 필터' })
    @ApiResponse({ status: 200, description: '템플릿 목록 조회 성공', type: [CreateTemplateDto] })
    @ApiResponse({ status: 400, description: '잘못된 요청' })
    async findAll(@Query(new ValidationPipe({ transform: true })) filterDto: TemplateFilterDto): Promise<any[]> {
        return this.templateService.findAllTemplates(filterDto);
    }

    @Post()
    @ApiOperation({ summary: '템플릿 생성', description: '새로운 알림 템플릿을 생성합니다.' })
    @ApiBody({ type: CreateTemplateDto, description: '생성할 템플릿 정보' })
    @ApiResponse({ status: 201, description: '템플릿 생성 성공', type: CreateTemplateDto })
    @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
    @ApiResponse({ status: 500, description: '서버 오류' })
    async create(@Body(ValidationPipe) createTemplateDto: CreateTemplateDto): Promise<any> {
        return this.templateService.createTemplate(createTemplateDto);
    }

    // 파라미터 라우트들은 마지막에 정의
    @Post("register-kakao/:key")
    @ApiOperation({ summary: '카카오 템플릿 등록', description: '카카오 비즈메시지 템플릿을 NHN에 등록합니다.' })
    @ApiParam({ name: 'key', description: '템플릿 키', type: 'string' })
    @ApiBody({ description: '카카오 템플릿 데이터' })
    @ApiResponse({ status: 201, description: '카카오 템플릿 등록 성공' })
    @ApiResponse({ status: 400, description: '잘못된 템플릿 데이터' })
    @ApiResponse({ status: 404, description: '템플릿을 찾을 수 없음' })
    async registerKakaoTemplate(@Param("key") templateKey: string, @Body() templateData: any): Promise<any> {
        return this.templateService.registerKakaoTemplate(templateKey, templateData);
    }

    @Post("register-sms/:key")
    @ApiOperation({ summary: 'SMS 템플릿 등록', description: 'SMS 템플릿을 외부 서비스에 등록합니다.' })
    @ApiParam({ name: 'key', description: '템플릿 키', type: 'string' })
    @ApiResponse({ status: 201, description: 'SMS 템플릿 등록 성공' })
    @ApiResponse({ status: 400, description: '잘못된 템플릿 키' })
    @ApiResponse({ status: 404, description: '템플릿을 찾을 수 없음' })
    async registerSmsTemplate(@Param("key") templateKey: string): Promise<any> {
        return this.templateService.registerSmsTemplate(templateKey);
    }

    @Get("by-id/:id")
    @ApiOperation({ summary: '템플릿 상세 조회', description: 'ID로 특정 템플릿의 상세 정보를 조회합니다.' })
    @ApiParam({ name: 'id', description: '템플릿 ID', type: 'string' })
    @ApiResponse({ status: 200, description: '템플릿 조회 성공', type: CreateTemplateDto })
    @ApiResponse({ status: 404, description: '템플릿을 찾을 수 없음' })
    async findOne(@Param("id") id: string): Promise<any> {
        return this.templateService.findTemplateById(id);
    }

    @Put("by-id/:id")
    @ApiOperation({ summary: '템플릿 수정', description: '기존 템플릿을 수정합니다.' })
    @ApiParam({ name: 'id', description: '템플릿 ID', type: 'string' })
    @ApiBody({ type: UpdateTemplateDto, description: '수정할 템플릿 정보' })
    @ApiResponse({ status: 200, description: '템플릿 수정 성공', type: CreateTemplateDto })
    @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
    @ApiResponse({ status: 404, description: '템플릿을 찾을 수 없음' })
    async update(@Param("id") id: string, @Body() updateTemplateDto: UpdateTemplateDto): Promise<any> {
        return this.templateService.updateTemplate(id, updateTemplateDto);
    }

    @Delete("by-id/:id")
    @ApiOperation({ summary: '템플릿 삭제', description: '기존 템플릿을 삭제합니다.' })
    @ApiParam({ name: 'id', description: '템플릿 ID', type: 'string' })
    @ApiResponse({ status: 200, description: '템플릿 삭제 성공' })
    @ApiResponse({ status: 404, description: '템플릿을 찾을 수 없음' })
    async remove(@Param("id") id: string): Promise<any> {
        return this.templateService.deleteTemplate(id);
    }

    @Post("preview/:id")
    @ApiOperation({ summary: '템플릿 미리보기', description: '템플릿을 특정 채널로 미리보기합니다.' })
    @ApiParam({ name: 'id', description: '템플릿 ID', type: 'string' })
    @ApiBody({ type: PreviewTemplateDto, description: '미리보기 설정' })
    @ApiResponse({ status: 200, description: '미리보기 생성 성공' })
    @ApiResponse({ status: 400, description: '잘못된 미리보기 데이터' })
    @ApiResponse({ status: 404, description: '템플릿을 찾을 수 없음' })
    async previewTemplate(@Param("id") id: string, @Body(ValidationPipe) previewDto: PreviewTemplateDto): Promise<any> {
        return this.templateService.previewTemplate(id, "EMAIL", previewDto);
    }

    @Post(":key/test/:channel")
    @ApiOperation({ summary: '템플릿 테스트', description: '특정 채널로 템플릿을 테스트 발송합니다.' })
    @ApiParam({ name: 'key', description: '템플릿 키', type: 'string' })
    @ApiParam({ name: 'channel', description: '발송 채널 (EMAIL, SMS, KAKAO, PUSH)', type: 'string' })
    @ApiBody({ description: '테스트 데이터' })
    @ApiResponse({ status: 200, description: '테스트 발송 성공' })
    @ApiResponse({ status: 400, description: '잘못된 테스트 데이터' })
    @ApiResponse({ status: 404, description: '템플릿을 찾을 수 없음' })
    async testTemplateWithChannel(
        @Param("key") templateKey: string,
        @Param("channel") channel: string,
        @Body() testDto: any
    ): Promise<any> {
        return this.templateService.previewTemplate(templateKey, channel, testDto);
    }
}
