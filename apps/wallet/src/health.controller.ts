import { Controller, Get, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { WalletSchema } from './schema';

@SetMetadata('isPublic', true)
@ApiTags('Health')
@Controller('v1')
export class HealthController {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  health(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  async ready(): Promise<{ status: 'ok'; timestamp: string }> {
    await this.dbService.db.execute(sql`select 1`);
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
