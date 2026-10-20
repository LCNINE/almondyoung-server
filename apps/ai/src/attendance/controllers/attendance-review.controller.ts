import { InternalOnly } from '@app/authorization';
import { Body, Controller, Post } from '@nestjs/common';
import { AttendanceReviewDto } from '../dto/attendance-review.dto';
import { AttendanceReviewService } from '../services/attendance-review.service';

@Controller('internal/attendance')
@InternalOnly()
export class AttendanceReviewController {
  constructor(private readonly service: AttendanceReviewService) {}

  @Post('review')
  review(@Body() input: AttendanceReviewDto) {
    return this.service.review(input);
  }
}
