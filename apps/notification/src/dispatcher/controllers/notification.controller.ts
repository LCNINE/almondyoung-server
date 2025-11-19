import { Notification } from '../services/notification-dispatcher.service';
// apps/notification/src/dispatcher/controllers/notification.controller.ts
import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    Query,
    ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { SendNotificationDto } from '../dto/send-notification.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
    constructor(
        private readonly dispatcherService: NotificationDispatcherService,
    ) { }

    @Post('send')
    @ApiOperation({ 
        summary: '알림 발송', 
        description: '단일 또는 다중 채널로 알림을 즉시 발송합니다.' 
    })
    @ApiBody({ type: SendNotificationDto, description: '발송할 알림 정보' })
    @ApiResponse({ status: 201, description: '알림 발송 성공' })
    @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
    @ApiResponse({ status: 500, description: '발송 실패' })
    async send(@Body(ValidationPipe) dto: SendNotificationDto) {
        return this.dispatcherService.send(dto);
    }

    @Get(':id')
    @ApiOperation({ 
        summary: '알림 상세 조회', 
        description: 'ID로 특정 알림의 상세 정보와 발송 상태를 조회합니다.' 
    })
    @ApiParam({ name: 'id', description: '알림 ID', type: 'string' })
    @ApiResponse({ status: 200, description: '알림 조회 성공' })
    @ApiResponse({ status: 404, description: '알림을 찾을 수 없음' })
    async getOne(@Param('id') id: string): Promise<Notification> {
        return this.dispatcherService.getNotification(id);
    }

    @Get('users/:userId')
    @ApiOperation({ 
        summary: '사용자 알림 목록 조회', 
        description: '특정 사용자가 받은 알림 목록을 조회합니다.' 
    })
    @ApiParam({ name: 'userId', description: '사용자 ID', type: 'string' })
    @ApiQuery({ name: 'limit', required: false, type: Number, description: '조회 개수 제한 (기본값: 50)' })
    @ApiResponse({ status: 200, description: '사용자 알림 목록 조회 성공' })
    @ApiResponse({ status: 404, description: '사용자를 찾을 수 없음' })
    async getUserNotifications(
        @Param('userId') userId: string,
        @Query('limit') limit?: number,
    ): Promise<Notification[]> {
        return this.dispatcherService.getUserNotifications(userId, limit || 50);
    }

    // 이벤트 기반 개별 발송 엔드포인트
    @Post('events/process')
    @ApiOperation({ 
        summary: '이벤트 기반 알림 처리', 
        description: '특정 이벤트 발생 시 해당 사용자에게 알림을 발송합니다.' 
    })
    @ApiBody({ 
        description: '이벤트 데이터',
        schema: {
            type: 'object',
            properties: {
                eventKey: { type: 'string', description: '이벤트 키' },
                userId: { type: 'string', description: '사용자 ID' },
                payload: { type: 'object', description: '이벤트 데이터' },
                channels: { type: 'array', items: { type: 'string' }, description: '발송 채널 목록' },
                metadata: { type: 'object', description: '메타데이터' }
            },
            required: ['eventKey', 'userId', 'payload']
        }
    })
    @ApiResponse({ status: 201, description: '이벤트 처리 성공' })
    @ApiResponse({ status: 400, description: '잘못된 이벤트 데이터' })
    @ApiResponse({ status: 404, description: '이벤트 또는 사용자를 찾을 수 없음' })
    async processEvent(@Body(ValidationPipe) eventData: {
        eventKey: string;
        userId: string;
        payload: Record<string, any>;
        channels?: string[];
        metadata?: Record<string, any>;
    }) {
        return this.dispatcherService.processEvent(eventData);
    }

    // 카프카 이벤트 수신 엔드포인트 (예시)
    @Post('events/kafka')
    @ApiOperation({ 
        summary: 'Kafka 이벤트 처리', 
        description: 'Kafka에서 수신한 이벤트를 처리하여 알림을 발송합니다.' 
    })
    @ApiBody({ 
        description: 'Kafka 이벤트 데이터',
        schema: {
            type: 'object',
            properties: {
                topic: { type: 'string', description: 'Kafka 토픽' },
                partition: { type: 'number', description: '파티션 번호' },
                offset: { type: 'number', description: '오프셋' },
                key: { type: 'string', description: '메시지 키' },
                value: { type: 'object', description: '메시지 값' },
                timestamp: { type: 'string', description: '타임스탬프' }
            },
            required: ['topic', 'partition', 'offset', 'key', 'value', 'timestamp']
        }
    })
    @ApiResponse({ status: 201, description: 'Kafka 이벤트 처리 성공' })
    @ApiResponse({ status: 400, description: '잘못된 Kafka 이벤트 데이터' })
    async handleKafkaEvent(@Body() kafkaEvent: {
        topic: string;
        partition: number;
        offset: number;
        key: string;
        value: any;
        timestamp: string;
    }) {
        // 카프카 이벤트를 내부 이벤트 형식으로 변환
        const eventData = {
            eventKey: kafkaEvent.topic,
            userId: kafkaEvent.value.userId,
            payload: kafkaEvent.value.payload || {},
            channels: kafkaEvent.value.channels,
            metadata: {
                kafkaTopic: kafkaEvent.topic,
                kafkaPartition: kafkaEvent.partition,
                kafkaOffset: kafkaEvent.offset,
                kafkaTimestamp: kafkaEvent.timestamp,
            }
        };

        return this.dispatcherService.processEvent(eventData);
    }
}
