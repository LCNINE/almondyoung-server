import { Controller, Get } from '@nestjs/common';
import { HealthService } from '../services/health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth() {
    return this.healthService.checkHealth();
  }

  @Get('ready')
  async getReadiness() {
    return this.healthService.checkReadiness();
  }

  @Get('live')
  async getLiveness() {
    return this.healthService.checkLiveness();
  }

  @Get('detailed')
  async getDetailedHealth() {
    return this.healthService.getDetailedHealth();
  }
}