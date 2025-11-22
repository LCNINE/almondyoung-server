import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FileServiceService } from './file-service.service';

@ApiTags('Health')
@Controller()
export class FileServiceController {
  constructor(private readonly fileServiceService: FileServiceService) { }

  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  getHello(): string {
    return this.fileServiceService.getHello();
  }
}
