import { DbModule } from '@app/db';
import { Module } from '@nestjs/common';
import { OAuthCorsModule } from '../../oauth/cors/oauth-cors.module';
import { OAuthClientsController } from './oauth-clients.controller';
import { OAuthClientsManager } from './oauth-clients.manager';
import { OAuthClientsReader } from './oauth-clients.reader';
import { OAuthClientsRepository } from './oauth-clients.repository';
import { OAuthClientsService } from './oauth-clients.service';

@Module({
  imports: [DbModule, OAuthCorsModule],
  controllers: [OAuthClientsController],
  providers: [OAuthClientsService, OAuthClientsReader, OAuthClientsManager, OAuthClientsRepository],
  exports: [OAuthClientsService],
})
export class AdminOAuthClientsModule {}
