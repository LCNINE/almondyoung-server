import { Controller, Get, Header } from '@nestjs/common';
import { SkipResponseEnvelope } from '@app/shared';
import { Public } from '../../commons/decorator/public.decorator';
import { JwksResponse, OidcDiscoveryResponse, WellKnownService } from './well-known.service';

@Controller('.well-known')
@SkipResponseEnvelope()
export class WellKnownController {
  constructor(private readonly service: WellKnownService) {}

  @Public()
  @Get('openid-configuration')
  @Header('Cache-Control', 'public, max-age=300')
  getOpenIdConfiguration(): OidcDiscoveryResponse {
    return this.service.getDiscovery();
  }

  @Public()
  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  getJwks(): JwksResponse {
    return this.service.getJwks();
  }
}
