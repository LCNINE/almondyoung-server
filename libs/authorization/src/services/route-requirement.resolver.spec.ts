import { Controller, Get, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { KeyAuthRoute } from '../decorators/key-auth-route.decorator';
import { OptionalAuth } from '../decorators/optional-auth.decorator';
import { Public } from '../decorators/public.decorator';
import { RequireAnyPermission, RequirePermission } from '../decorators/require-permission.decorator';
import { StoreRoute } from '../decorators/store-route.decorator';
import { methodOf, rawResponseOf, rolesOf } from './request-identity';
import { RouteRequirementResolver } from './route-requirement.resolver';

@Controller('orders')
class OrdersController {
  @RequirePermission('order.order.read')
  @Get()
  list() {}

  @RequireAnyPermission('fulfillment.dispatch.force', 'fulfillment.dispatch.station_force')
  @Get('force')
  force() {}

  @Public()
  @Get('health')
  health() {}

  @OptionalAuth()
  @Get('maybe')
  maybe() {}

  @StoreRoute()
  @Get('mine')
  mine() {}

  @KeyAuthRoute()
  @Get('merchant')
  merchant() {}

  @Get(':id')
  unmarked() {}
}

@StoreRoute()
@Controller()
class CustomerController {
  @Get('me')
  me() {}
}

// 선례: libs/events/src/interceptors/event-retry.interceptor.spec.ts
function contextFor(cls: Type, handler: (...args: unknown[]) => unknown): ExecutionContextHost {
  const host = new ExecutionContextHost([{}, {}], cls, handler);
  host.setType('http');
  return host;
}

describe('RouteRequirementResolver', () => {
  const resolver = new RouteRequirementResolver(new Reflector());
  const proto = OrdersController.prototype;

  it('reads a single permission and the route path', () => {
    expect(resolver.resolve(contextFor(OrdersController, proto.list))).toEqual({
      requirement: { kind: 'permission', anyOf: ['order.order.read'] },
      path: '/orders',
    });
  });

  it('reads an any-of permission list', () => {
    expect(resolver.resolve(contextFor(OrdersController, proto.force)).requirement).toEqual({
      kind: 'permission',
      anyOf: ['fulfillment.dispatch.force', 'fulfillment.dispatch.station_force'],
    });
  });

  it('treats public, optional, customer and key routes as open', () => {
    for (const handler of [proto.health, proto.maybe, proto.mine, proto.merchant]) {
      expect(resolver.resolve(contextFor(OrdersController, handler)).requirement).toEqual({ kind: 'open' });
    }
  });

  it('inherits a class-level customer marker', () => {
    expect(resolver.resolve(contextFor(CustomerController, CustomerController.prototype.me))).toEqual({
      requirement: { kind: 'open' },
      path: '/me',
    });
  });

  it('reports an unmarked route as unclassified', () => {
    expect(resolver.resolve(contextFor(OrdersController, proto.unmarked))).toEqual({
      requirement: { kind: 'unclassified' },
      path: '/orders/:id',
    });
  });

  it('returns the same object for the same handler', () => {
    const first = resolver.resolve(contextFor(OrdersController, proto.list));
    expect(resolver.resolve(contextFor(OrdersController, proto.list))).toBe(first);
  });
});

describe('request identity', () => {
  it('reads string roles of an authenticated user', () => {
    expect(rolesOf({ user: { roles: ['admin', 7, 'intern'] } })).toEqual(['admin', 'intern']);
  });

  it('separates «not authenticated» from «authenticated without roles»', () => {
    expect(rolesOf({})).toBeUndefined();
    expect(rolesOf({ user: {} })).toEqual([]);
    expect(rolesOf(undefined)).toBeUndefined();
  });

  it('reads the http method', () => {
    expect(methodOf({ method: 'POST' })).toBe('POST');
    expect(methodOf({})).toBe('?');
  });

  it('finds the node response for express and fastify', () => {
    const raw = new ServerResponse(new IncomingMessage(new Socket()));
    expect(rawResponseOf(raw)).toBe(raw);
    expect(rawResponseOf({ raw })).toBe(raw);
    expect(rawResponseOf({ raw: {} })).toBeUndefined();
  });
});
