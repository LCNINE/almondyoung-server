import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../commons/decorator/public.decorator';
import { JwksResponse, OidcDiscoveryResponse, WellKnownService } from './well-known.service';

@Controller('.well-known')
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
