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

@Controller('api/v1/events')
export class EventController {
    constructor(private readonly eventMappingService: EventMappingService) { }

    @Get()
    async findAll() {
        return this.eventMappingService.findAll();
    }

    @Get(':eventKey')
    async findOne(@Param('eventKey') eventKey: string) {
        return this.eventMappingService.findByKey(eventKey);
    }

    @Post()
    async create(@Body(ValidationPipe) dto: any) {
        return this.eventMappingService.create(dto);
    }

    @Put(':eventKey')
    async update(
        @Param('eventKey') eventKey: string,
        @Body(ValidationPipe) dto: any,
    ) {
        return this.eventMappingService.update(eventKey, dto);
    }
}