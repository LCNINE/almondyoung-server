import { Controller, Post, Get, Delete, Body, Param, ParseIntPipe } from '@nestjs/common';
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
    const record = await this.testService.createTestRecord(dto);
    return {
      success: true,
      data: record,
      message: 'Test record created and event saved to outbox',
    };
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
    const record = await this.testService.deleteTestRecord(id);
    return {
      success: true,
      data: record,
      message: 'Test record deleted and event saved to outbox',
    };
  }
}
