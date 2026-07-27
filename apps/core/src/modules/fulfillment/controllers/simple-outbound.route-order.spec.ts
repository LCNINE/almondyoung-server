import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ScopeGuard } from '@app/authorization';
import { SimpleOutboundController } from './simple-outbound.controller';
import { ShipmentPlanningController } from './shipment-planning.controller';
import { SimpleOutboundService } from '../services/simple-outbound.service';
import { ShipmentWaybillReader } from '../reader/shipment-waybill.reader';
import { ShipmentPlanningService } from '../services/shipment-planning.service';

/**
 * Route-ordering regression net for `GET /shipments/by-waybill`.
 *
 * `SimpleOutboundController` and `ShipmentPlanningController` both register `@Controller('shipments')`.
 * `ShipmentPlanningController` has a bare `@Get(':id')` (shipment-planning.controller.ts:72) guarded by
 * the SAME scope (`WAREHOUSE_OPERATE`) as `by-waybill` — so if it were matched first, `:id` would bind
 * to the literal string `'by-waybill'` and return a 200 from the wrong handler, not a 401/404. That
 * failure mode is silent unless something actually drives a request through Nest's router.
 *
 * `fulfillment.module.ts` registers `SimpleOutboundController` before `ShipmentPlanningController` in
 * its `controllers` array specifically to avoid this. This test derives the order to drive the router
 * harness with directly from that file, instead of hand-copying it into a second, parallel array here
 * (which would keep passing even if the real module got reordered).
 *
 * Deriving the order requires reading `fulfillment.module.ts` WITHOUT importing/executing it: importing
 * it (statically or dynamically, `require` or `import()` — evaluation happens either way) pulls in
 * `SalesOrderModule`, which calls `EventsModule.forConsumerModule(...)` at class-decoration time; that
 * throws synchronously (`Cannot read properties of null (reading 'clientId')`) in any process without
 * `KAFKA_BROKERS` set, and is the same hazard `waybill.module.spec.ts` already documents and works
 * around for `WaybillModule`. So instead of `Reflect.getMetadata('controllers', FulfillmentModule)` on
 * an imported class, this test parses `fulfillment.module.ts`'s source with the TypeScript compiler API
 * and reads the `controllers: [...]` array literal directly out of its `@Module({...})` decorator —
 * zero execution, zero side effects, and it still fails if the real array is ever reordered, or if
 * either controller is dropped from it.
 */

function readFulfillmentModuleControllerOrder(): string[] {
  const modulePath = path.join(__dirname, '..', 'fulfillment.module.ts');
  const source = fs.readFileSync(modulePath, 'utf8');
  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.Latest, true);

  let controllerNames: string[] | undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === 'FulfillmentModule') {
      const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
      const moduleDecorator = decorators?.find(
        (decorator) =>
          ts.isCallExpression(decorator.expression) &&
          ts.isIdentifier(decorator.expression.expression) &&
          decorator.expression.expression.text === 'Module',
      );
      const moduleCall = moduleDecorator?.expression;
      const optionsArg = moduleCall && ts.isCallExpression(moduleCall) ? moduleCall.arguments[0] : undefined;

      if (optionsArg && ts.isObjectLiteralExpression(optionsArg)) {
        const controllersProp = optionsArg.properties.find(
          (prop): prop is ts.PropertyAssignment =>
            ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'controllers',
        );

        if (controllersProp && ts.isArrayLiteralExpression(controllersProp.initializer)) {
          controllerNames = controllersProp.initializer.elements.map((element) => {
            if (!ts.isIdentifier(element)) {
              throw new Error(
                `FulfillmentModule.controllers has a non-identifier entry (${element.getText(sourceFile)}) in ` +
                  `${modulePath} — expected a plain class reference. Refusing to fall back to a hardcoded order.`,
              );
            }
            return element.text;
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (!controllerNames || controllerNames.length === 0) {
    throw new Error(
      `Could not find FulfillmentModule's @Module({ controllers: [...] }) array in ${modulePath}. ` +
        'Refusing to fall back to a hardcoded order.',
    );
  }

  return controllerNames;
}

describe('shipments route ordering (by-waybill vs :id)', () => {
  it('derives SimpleOutboundController before ShipmentPlanningController from fulfillment.module.ts', () => {
    const controllerOrder = readFulfillmentModuleControllerOrder();

    const simpleOutboundIndex = controllerOrder.indexOf('SimpleOutboundController');
    const shipmentPlanningIndex = controllerOrder.indexOf('ShipmentPlanningController');

    if (simpleOutboundIndex === -1 || shipmentPlanningIndex === -1) {
      throw new Error(
        "FulfillmentModule's controllers array is missing SimpleOutboundController and/or " +
          `ShipmentPlanningController (indices: simpleOutbound=${simpleOutboundIndex}, ` +
          `shipmentPlanning=${shipmentPlanningIndex}). Refusing to fall back to a hardcoded order.`,
      );
    }

    expect(simpleOutboundIndex).toBeLessThan(shipmentPlanningIndex);
  });

  it('resolves GET /shipments/by-waybill to the waybill reader, not the planning :id handler', async () => {
    const controllerOrder = readFulfillmentModuleControllerOrder();
    const simpleOutboundIndex = controllerOrder.indexOf('SimpleOutboundController');
    const shipmentPlanningIndex = controllerOrder.indexOf('ShipmentPlanningController');

    if (simpleOutboundIndex === -1 || shipmentPlanningIndex === -1) {
      throw new Error(
        "FulfillmentModule's controllers array is missing SimpleOutboundController and/or " +
          `ShipmentPlanningController (indices: simpleOutbound=${simpleOutboundIndex}, ` +
          `shipmentPlanning=${shipmentPlanningIndex}). Refusing to fall back to a hardcoded order.`,
      );
    }

    // Drive the harness's controller order from fulfillment.module.ts's real declared order rather
    // than a hand-maintained literal — do not replace this with `[SimpleOutboundController, ShipmentPlanningController]`.
    const routeOrderControllers =
      simpleOutboundIndex < shipmentPlanningIndex
        ? [SimpleOutboundController, ShipmentPlanningController]
        : [ShipmentPlanningController, SimpleOutboundController];

    const byTrackingNo = jest.fn().mockResolvedValue({ shipmentId: 's-1' });
    const getShipmentDetail = jest.fn().mockResolvedValue({ shipmentId: 'by-waybill' });

    const moduleRef = await Test.createTestingModule({
      controllers: routeOrderControllers,
      providers: [
        { provide: SimpleOutboundService, useValue: { scan: jest.fn(), forceComplete: jest.fn() } },
        { provide: ShipmentWaybillReader, useValue: { byTrackingNo } },
        { provide: ShipmentPlanningService, useValue: { getShipmentDetail } },
      ],
    })
      .overrideGuard(ScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer()).get('/shipments/by-waybill?trackingNo=T-1').expect(200);

      expect(byTrackingNo).toHaveBeenCalledWith('T-1');
      expect(getShipmentDetail).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
