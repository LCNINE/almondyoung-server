import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublishProductVersionDto } from './publish-product-version.dto';

describe('PublishProductVersionDto', () => {
  it('keeps legacy empty publish requests valid', async () => {
    expect(await validate(plainToInstance(PublishProductVersionDto, {}))).toEqual([]);
  });

  it('accepts only the supported bulk origin and a UUID expected head', async () => {
    expect(
      await validate(
        plainToInstance(PublishProductVersionDto, {
          origin: 'bulk_import',
          expectedActiveVersionId: '019ff088-3f26-74ae-a6b2-b8180bc5a22b',
        }),
      ),
    ).toEqual([]);
    expect(
      (await validate(plainToInstance(PublishProductVersionDto, { origin: 'skip-events' }))).length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(plainToInstance(PublishProductVersionDto, { expectedActiveVersionId: 'invalid' }))).length,
    ).toBeGreaterThan(0);
  });
});
