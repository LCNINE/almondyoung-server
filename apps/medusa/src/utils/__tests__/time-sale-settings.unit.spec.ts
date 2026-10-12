import { Modules } from '@medusajs/framework/utils';
import { loadTimeSaleSettings, saveTimeSaleSettings } from '../time-sale-settings';
import { defaultTimeSaleSettings, validateTimeSaleSettings } from '../../../../../packages/domain-types/time-sale';

describe('time-sale settings trust boundary', () => {
  it('rejects executable CSS and invalid image sizes', () => {
    const settings = defaultTimeSaleSettings();
    settings.environment.imageSize = 0;
    expect(() => validateTimeSaleSettings(settings)).toThrow();
    settings.environment.imageSize = 100;
    settings.styles.main.mobile.components.push({
      ...settings.styles.main.mobile.components[0],
      id: 'unsafe',
      css: { backgroundImage: 'url(javascript:alert(1))' },
    });
    expect(() => validateTimeSaleSettings(settings)).toThrow();
  });

  it('accepts the default (live-identical) settings as saved', () => {
    expect(() => validateTimeSaleSettings(defaultTimeSaleSettings())).not.toThrow();
  });
});

describe('time-sale settings store', () => {
  const containerWith = (metadata: Record<string, unknown> | null) => {
    const updateStores = jest.fn();
    const services: Record<string, unknown> = {
      [Modules.STORE]: { listStores: async () => [{ id: 'store_1', metadata }], updateStores },
      [Modules.LOCKING]: { execute: async (_key: string, run: () => Promise<unknown>) => run() },
      logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
    };
    const container = { resolve: (key: string) => services[key] } as never;
    return { container, updateStores };
  };

  it('returns null when nothing has been saved, so each screen uses its own defaults', async () => {
    const { container } = containerWith({});
    await expect(loadTimeSaleSettings(container)).resolves.toEqual({ settings: null, revision: '' });
  });

  it('refuses to overwrite when another admin saved first (revision mismatch)', async () => {
    const { container, updateStores } = containerWith({ timeSaleSettingsRevision: 'newer' });
    await expect(saveTimeSaleSettings(container, defaultTimeSaleSettings(), 'older')).rejects.toThrow(
      '다른 관리자가 설정을 변경했습니다',
    );
    expect(updateStores).not.toHaveBeenCalled();
  });
});
