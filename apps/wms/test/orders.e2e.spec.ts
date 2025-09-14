import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WmsModule } from '../src/wms.module';

describe('Orders E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WmsModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create sales order and list', async () => {
    const so = {
      channelOrderId: 'ch-1',
      salesChannel: 'medusa',
      shippingAddress: { addr: 'x' },
      lines: [{ variantId: 'v-1', quantity: 1, productName: 'p' }],
    } as any;
    const created = await request(app.getHttpServer()).post('/wms/sales-orders').send(so).expect(201);
    expect(created.body.id).toBeDefined();

    const list = await request(app.getHttpServer()).get('/wms/sales-orders?limit=10').expect(200);
    expect(Array.isArray(list.body)).toBe(true);
  });

  it('should create fulfillment and check availability', async () => {
    const fo = {
      warehouseId: '00000000-0000-0000-0000-000000000000',
      lines: [{ skuId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
    } as any;
    const created = await request(app.getHttpServer()).post('/wms/fulfillments').send(fo).expect(201);
    expect(created.body.id).toBeDefined();

    const avail = await request(app.getHttpServer()).post(`/wms/fulfillments/${created.body.id}/check-availability`).expect(201);
    expect(typeof avail.body.ready).toBe('boolean');
  });

  it('should upsert and get product matching (header only)', async () => {
    const variantId = '00000000-0000-0000-0000-000000000001';
    const up = await request(app.getHttpServer()).put(`/wms/matchings/${variantId}`).send({ links: [] }).expect(200);
    expect(up.body).toBeTruthy();
    const got = await request(app.getHttpServer()).get(`/wms/matchings/${variantId}`).expect(200);
    expect(got.body?.variantId).toBe(variantId);
  });

  it('should merge two sales orders and cancel originals', async () => {
    // create two SOs
    const so1 = await request(app.getHttpServer()).post('/wms/sales-orders').send({
      channelOrderId: 'ch-m-1',
      salesChannel: 'medusa',
      shippingAddress: { addr: 'x' },
      lines: [{ variantId: 'v-m-1', quantity: 1, productName: 'p1' }],
    }).expect(201);
    const so2 = await request(app.getHttpServer()).post('/wms/sales-orders').send({
      channelOrderId: 'ch-m-2',
      salesChannel: 'medusa',
      shippingAddress: { addr: 'y' },
      lines: [{ variantId: 'v-m-2', quantity: 2, productName: 'p2' }],
    }).expect(201);

    // merge
    const merged = await request(app.getHttpServer()).post('/wms/sales-orders/merge').send({ sourceOrderIds: [so1.body.id, so2.body.id] }).expect(201);
    expect(merged.body.id).toBeDefined();

    // originals should be cancelled
    const orig1 = await request(app.getHttpServer()).get(`/wms/sales-orders/${so1.body.id}`).expect(200);
    const orig2 = await request(app.getHttpServer()).get(`/wms/sales-orders/${so2.body.id}`).expect(200);
    expect(orig1.body.status).toBe('cancelled');
    expect(orig2.body.status).toBe('cancelled');
  });
});


