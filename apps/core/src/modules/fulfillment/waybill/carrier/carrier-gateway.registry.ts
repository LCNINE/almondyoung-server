import type { CarrierCode, CarrierGateway } from './carrier-gateway.interface';

export class CarrierGatewayRegistry {
  private readonly byCarrier = new Map<CarrierCode, CarrierGateway>();
  constructor(gateways: CarrierGateway[]) {
    for (const g of gateways) this.byCarrier.set(g.carrier, g);
  }
  get(carrier: CarrierCode): CarrierGateway | undefined {
    return this.byCarrier.get(carrier);
  }
}
