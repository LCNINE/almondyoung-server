import { DbService } from '@app/db';
import { getPublisherToken } from '@app/events/publishers/publisher-token';
import { Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { AdminBusinessLicensesModule } from '../admin/business-licenses/business-licenses.module';
import { UsersModule } from './users.module';
import { UsersService } from './users.service';

const providersOf = (module: Type<unknown>): Provider[] => Reflect.getMetadata('providers', module) ?? [];

describe.each([
  ['UsersModule', UsersModule],
  ['AdminBusinessLicensesModule', AdminBusinessLicensesModule],
])('%s provides everything UsersService needs', (_name, module) => {
  it('compiles with only the database and the publisher supplied from outside', async () => {
    const compiled = await Test.createTestingModule({
      providers: [
        ...providersOf(module).filter((p): p is Type<unknown> => typeof p === 'function'),
        { provide: DbService, useValue: { db: {} } },
        { provide: getPublisherToken(USER_STREAM.topic.topic), useValue: {} },
      ],
    }).compile();

    expect(compiled.get(UsersService)).toBeInstanceOf(UsersService);
  });
});
