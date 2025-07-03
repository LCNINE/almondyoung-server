import { Controller } from '@nestjs/common';
import { DormantService } from './dormant.service';

@Controller('dormant')
export class DormantController {
  constructor(private readonly dormantService: DormantService) {}
}
