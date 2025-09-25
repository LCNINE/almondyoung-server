import { NotificationEvent } from '../services/event-mapping.service';
// apps/notification/src/event-handlers/controllers/event.controller.ts
import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Param,
    ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { EventMappingService } from '../services/event-mapping.service';
import { CreateEventDto, UpdateEventDto, TriggerEventDto } from '../dto/event.dto';

@ApiTags('event-handlers')
@Controller('api/v1/events')
export class EventController {
    constructor(private readonly eventMappingService: EventMappingService) { }

    @Post('trigger')
    @ApiOperation({ 
        summary: '이벤트 트리거', 
        description: '특정 이벤트를 수동으로 트리거하여 연결된 알림을 발송합니다.' 
    })
    @ApiBody({ type: TriggerEventDto, description: '트리거할 이벤트 정보' })
    @ApiResponse({ status: 201, description: '이벤트 트리거 성공' })
    @ApiResponse({ status: 400, description: '잘못된 이벤트 데이터' })
    @ApiResponse({ status: 404, description: '이벤트를 찾을 수 없음' })
    async triggerEvent(@Body(ValidationPipe) dto: TriggerEventDto) {
        return this.eventMappingService.triggerEvent(dto);
    }

    @Get()
    @ApiOperation({ 
        summary: '전체 이벤트 목록 조회', 
        description: '시스템에 등록된 모든 이벤트 매핑 정보를 조회합니다.' 
    })
    @ApiResponse({ status: 200, description: '이벤트 목록 조회 성공' })
    async getAllEvents(): Promise<NotificationEvent[]> {
        return this.eventMappingService.getAllEvents();
    }

    @Get(':eventKey')
    @ApiOperation({ 
        summary: '이벤트 상세 조회', 
        description: '이벤트 키로 특정 이벤트의 상세 정보를 조회합니다.' 
    })
    @ApiParam({ name: 'eventKey', description: '이벤트 키', type: 'string' })
    @ApiResponse({ status: 200, description: '이벤트 조회 성공' })
    @ApiResponse({ status: 404, description: '이벤트를 찾을 수 없음' })
    async findOne(@Param('eventKey') eventKey: string): Promise<NotificationEvent> {
        return this.eventMappingService.getEventByKey(eventKey);
    }

    @Post()
    @ApiOperation({ 
        summary: '이벤트 생성', 
        description: '새로운 이벤트 매핑을 생성합니다.' 
    })
    @ApiBody({ type: CreateEventDto, description: '생성할 이벤트 정보' })
    @ApiResponse({ status: 201, description: '이벤트 생성 성공' })
    @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
    @ApiResponse({ status: 409, description: '이미 존재하는 이벤트 키' })
    async createEvent(@Body(ValidationPipe) dto: CreateEventDto): Promise<NotificationEvent> {
        return this.eventMappingService.createEvent(dto);
    }

    @Put(':eventKey')
    @ApiOperation({ 
        summary: '이벤트 수정', 
        description: '기존 이벤트 매핑을 수정합니다.' 
    })
    @ApiParam({ name: 'eventKey', description: '이벤트 키', type: 'string' })
    @ApiBody({ type: UpdateEventDto, description: '수정할 이벤트 정보' })
    @ApiResponse({ status: 200, description: '이벤트 수정 성공' })
    @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
    @ApiResponse({ status: 404, description: '이벤트를 찾을 수 없음' })
    async updateEvent(
        @Param('eventKey') eventKey: string,
        @Body(ValidationPipe) dto: UpdateEventDto,
    ): Promise<NotificationEvent> {
        return this.eventMappingService.updateEvent(eventKey, dto);
    }
}
