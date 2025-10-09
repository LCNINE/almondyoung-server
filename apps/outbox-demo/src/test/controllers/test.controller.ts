import { Controller, Post, Get, Delete, Body, Param, ParseIntPipe, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { TestService } from '../services/test.service';
import { CreateTestRecordDto } from '../dto/create-test-record.dto';

@Controller('test')
export class TestController {
  constructor(private readonly testService: TestService) {}

  /**
   * 테스트 레코드 생성
   *
   * POST /test
   * Body: { "name": "test1", "description": "test description" }
   */
  @Post()
  async createTestRecord(@Body() dto: CreateTestRecordDto) {
    try {
      const record = await this.testService.createTestRecord(dto);
      return {
        success: true,
        data: record,
        message: 'Test record created and event saved to outbox',
      };
    } catch (error) {
      throw new HttpException(
        `Failed to create test record: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 모든 테스트 레코드 조회
   *
   * GET /test
   */
  @Get()
  async getAllTestRecords() {
    const records = await this.testService.getAllTestRecords();
    return {
      success: true,
      data: records,
      count: records.length,
    };
  }

  /**
   * 특정 테스트 레코드 조회
   *
   * GET /test/:id
   */
  @Get(':id')
  async getTestRecordById(@Param('id', ParseIntPipe) id: number) {
    const record = await this.testService.getTestRecordById(id);

    if (!record) {
      throw new NotFoundException(`Test record with id ${id} not found`);
    }

    return {
      success: true,
      data: record,
    };
  }

  /**
   * 테스트 레코드 삭제
   *
   * DELETE /test/:id
   */
  @Delete(':id')
  async deleteTestRecord(@Param('id', ParseIntPipe) id: number) {
    try {
      const record = await this.testService.deleteTestRecord(id);
      return {
        success: true,
        data: record,
        message: 'Test record deleted and event saved to outbox',
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new NotFoundException(`Test record with id ${id} not found`);
      }
      throw new HttpException(
        `Failed to delete test record: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
