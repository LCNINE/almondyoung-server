import { Controller, Patch, Delete, Param, Body, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { LifecycleService } from './lifecycle.service';
import { ActivateFileDto } from './dto/activate-file.dto';
import { ActivateResponseDto, DeleteResponseDto } from './dto/activate-response.dto';

@ApiTags('Lifecycle')
@Controller('files')
export class LifecycleController {
  constructor(private readonly lifecycleService: LifecycleService) { }

  @Patch(':fileId/activate')
  @ApiOperation({ summary: 'Activate a file (pending → active)' })
  @ApiParam({ name: 'fileId', description: 'File ID', type: 'string' })
  @ApiResponse({ status: 200, description: 'File activated successfully', type: ActivateResponseDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 400, description: 'Cannot activate deleted file' })
  async activateFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: ActivateFileDto,
  ): Promise<ActivateResponseDto> {
    return this.lifecycleService.activateFile(fileId, dto);
  }

  @Delete(':fileId')
  @ApiOperation({ summary: 'Soft delete a file' })
  @ApiParam({ name: 'fileId', description: 'File ID', type: 'string' })
  @ApiResponse({ status: 200, description: 'File deleted successfully', type: DeleteResponseDto })
  @ApiResponse({ status: 404, description: 'File not found' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  async deleteFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<DeleteResponseDto> {
    const userId = 'temp-user-id';

    return this.lifecycleService.deleteFile(fileId, userId);
  }
}

