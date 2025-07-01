import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PublicPrivateGuard } from '../../commons/guards/auth.guard';
import { RolesGuard } from '../../commons/guards/roles.guard';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_VERIFICATION_TOKEN_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [RolesController],
  providers: [
    RolesService,
    {
      provide: APP_GUARD,
      useClass: PublicPrivateGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [RolesService],
})
export class RolesModule {}
