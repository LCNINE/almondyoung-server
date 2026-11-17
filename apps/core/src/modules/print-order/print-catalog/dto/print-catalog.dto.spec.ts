import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublishPrintProductDto } from './print-catalog.dto';

const body = (optionLabels?: unknown) => ({
  templateId: '0190f1d2-0000-7000-8000-00000000a001',
  kind: 'bizcard',
  width: 90,
  height: 50,
  name: '아몬드 명함',
  description: '',
  thumbnailFileId: '0190f1d2-0000-7000-8000-00000000a002',
  combos: [{ key: 'a', paperno: 1, colorno: 10, qty: 100, awk: [], price: 6000, memberPrice: null, optionLabels }],
});

const errorsOf = (plain: object) => validate(plainToInstance(PublishPrintProductDto, plain));

describe('PublishPrintProductDto', () => {
  it('accepts a combo with option labels and no member price', async () => {
    expect(await errorsOf(body({ paper: '아트지', side: '단면', qty: '100매' }))).toHaveLength(0);
  });

  it('rejects a combo without option labels', async () => {
    expect(await errorsOf(body())).not.toHaveLength(0);
  });

  it('rejects option labels given as an array', async () => {
    expect(await errorsOf(body(['아트지', '단면', '100매']))).not.toHaveLength(0);
  });
});
