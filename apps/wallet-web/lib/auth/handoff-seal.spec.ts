import { sealMedusaToken, unsealMedusaToken } from './handoff-seal';

const CART = 'cart_01ABC';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';

beforeAll(() => {
  process.env.CHECKOUT_HANDOFF_SECRET = 'test-secret';
});

describe('handoff seal', () => {
  it('봉인한 토큰을 같은 카트에서 그대로 되찾는다', () => {
    const sealed = sealMedusaToken(TOKEN, CART);
    expect(sealed).not.toContain(TOKEN);
    expect(unsealMedusaToken(sealed, CART)).toBe(TOKEN);
  });

  it('다른 카트로는 열리지 않는다', () => {
    const sealed = sealMedusaToken(TOKEN, CART);
    expect(unsealMedusaToken(sealed, 'cart_other')).toBeNull();
  });

  it('내용이 변조되면 열리지 않는다', () => {
    const [v, iv, tag, body] = sealMedusaToken(TOKEN, CART).split('.');
    const tampered = [v, iv, tag, body.slice(0, -2) + 'AA'].join('.');
    expect(unsealMedusaToken(tampered, CART)).toBeNull();
  });

  it('키가 다르면 열리지 않는다', () => {
    const sealed = sealMedusaToken(TOKEN, CART);
    process.env.CHECKOUT_HANDOFF_SECRET = 'another-secret';
    expect(unsealMedusaToken(sealed, CART)).toBeNull();
    process.env.CHECKOUT_HANDOFF_SECRET = 'test-secret';
  });

  it('만료되면 열리지 않는다', () => {
    const sealed = sealMedusaToken(TOKEN, CART);
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      expect(unsealMedusaToken(sealed, CART)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('형식이 깨진 값은 열리지 않는다', () => {
    expect(unsealMedusaToken('', CART)).toBeNull();
    expect(unsealMedusaToken('v1.only-two', CART)).toBeNull();
    expect(unsealMedusaToken('v2.a.b.c', CART)).toBeNull();
  });
});
