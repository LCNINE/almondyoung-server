import { INTERNAL_KEY_ENV } from '@app/authorization';
import { Module } from '@nestjs/common';
import { AttendanceReviewController } from './controllers/attendance-review.controller';
import { AttendanceReviewService } from './services/attendance-review.service';

@Module({
  controllers: [AttendanceReviewController],
  providers: [AttendanceReviewService, { provide: INTERNAL_KEY_ENV, useValue: 'AI_INTERNAL_KEY' }],
})
export class AttendanceAiModule {}
