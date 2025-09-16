// apps/notification/src/shared/controllers/event.controller.ts
import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Param,
    ValidationPipe,
} from '@nestjs/common';
import { EventMappingService } from '../services/event-mapping.service';
import { CreateEventDto, UpdateEventDto, TriggerEventDto } from '../dto/event.dto';

@Controller('api/v1/events')
export class EventController {
    constructor(private readonly eventMappingService: EventMappingService) { }

    @Post('trigger')
    async triggerEvent(@Body(ValidationPipe) dto: TriggerEventDto) {
        return this.eventMappingService.triggerEvent(dto);
    }

    @Get()
    async getAllEvents() {
        return this.eventMappingService.getAllEvents();
    }

    @Get(':eventKey')
    async findOne(@Param('eventKey') eventKey: string) {
        return this.eventMappingService.getEventByKey(eventKey);
    }

    @Post()
    async createEvent(@Body(ValidationPipe) dto: CreateEventDto) {
        return this.eventMappingService.createEvent(dto);
    }

    @Put(':eventKey')
    async updateEvent(
        @Param('eventKey') eventKey: string,
        @Body(ValidationPipe) dto: UpdateEventDto,
    ) {
        return this.eventMappingService.updateEvent(eventKey, dto);
    }
}
