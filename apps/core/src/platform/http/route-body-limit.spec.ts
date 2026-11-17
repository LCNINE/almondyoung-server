import Fastify from 'fastify';
import { INBOUND_SHIPMENT_UPLOAD_BODY_LIMIT, raiseBodyLimitForInboundShipmentUpload } from './route-body-limit';

describe('raiseBodyLimitForInboundShipmentUpload', () => {
  it('accepts a >1 MiB body on the upload route only', async () => {
    const app = Fastify();
    raiseBodyLimitForInboundShipmentUpload(app);
    app.post('/inventory/inbound-shipments', () => ({ ok: true }));
    app.post('/other', () => ({ ok: true }));
    const payload = JSON.stringify({ pad: 'x'.repeat(1_500_000) });
    const headers = { 'content-type': 'application/json' };

    expect(
      (await app.inject({ method: 'POST', url: '/inventory/inbound-shipments', payload, headers })).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/other', payload, headers })).statusCode).toBe(413);
    expect(INBOUND_SHIPMENT_UPLOAD_BODY_LIMIT).toBe(4 * 1024 * 1024);
  });
});
