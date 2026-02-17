import {
  HMAC_SIGNATURE_VERSION,
  HmacVerificationError,
  HmacVerificationErrorCode,
  buildSigningString,
  canonicalizeSnapshotPayload,
  computeHmacSignature,
  computePayloadHash,
  verifyHmacIntegrity,
} from './hmac-integrity';

describe('hmac-integrity', () => {
  const sharedSecret = 'wallet-shared-secret';
  const now = new Date('2026-02-17T10:00:00.000Z');

  it('canonicalizes nested payload deterministically', () => {
    const payload = {
      z: 1,
      a: {
        d: 4,
        c: 3,
      },
      list: [{ b: 2, a: 1 }, true, null],
    };

    expect(canonicalizeSnapshotPayload(payload)).toBe(
      '{"a":{"c":3,"d":4},"list":[{"a":1,"b":2},true,null],"z":1}',
    );
  });

  it('verifies valid signature', () => {
    const payload = {
      referenceType: 'STORE_ORDER',
      referenceId: 'order-123',
      payableAmount: 10900,
      currency: 'KRW',
    };
    const signedAt = '2026-02-17T09:59:20.000Z';

    const signedRequest = signRequest(payload, signedAt, sharedSecret);

    const result = verifyHmacIntegrity(
      {
        snapshotPayload: payload,
        signatureVersion: HMAC_SIGNATURE_VERSION,
        signedAt,
        signature: signedRequest.signature,
        now,
      },
      { sharedSecret },
    );

    expect(result.canonicalPayload).toBe(
      '{"currency":"KRW","payableAmount":10900,"referenceId":"order-123","referenceType":"STORE_ORDER"}',
    );
    expect(result.payloadHash).toBe(signedRequest.payloadHash);
    expect(result.signingString).toBe(signedRequest.signingString);
  });

  it('rejects unsupported signature version', () => {
    const payload = { a: 1 };
    const signedAt = '2026-02-17T09:59:20.000Z';
    const signedRequest = signRequest(payload, signedAt, sharedSecret);

    expectVerificationErrorCode(
      () =>
        verifyHmacIntegrity(
          {
            snapshotPayload: payload,
            signatureVersion: 'v2',
            signedAt,
            signature: signedRequest.signature,
            now,
          },
          { sharedSecret },
        ),
      'SIGNATURE_VERSION_UNSUPPORTED',
    );
  });

  it('rejects invalid timestamp format', () => {
    const payload = { a: 1 };
    const signedRequest = signRequest(payload, '2026-02-17T09:59:20.000Z', sharedSecret);

    expectVerificationErrorCode(
      () =>
        verifyHmacIntegrity(
          {
            snapshotPayload: payload,
            signatureVersion: HMAC_SIGNATURE_VERSION,
            signedAt: 'invalid-date',
            signature: signedRequest.signature,
            now,
          },
          { sharedSecret },
        ),
      'SIGNATURE_TIMESTAMP_INVALID',
    );
  });

  it('rejects expired signature', () => {
    const payload = { a: 1 };
    const signedAt = '2026-02-17T09:53:58.000Z';
    const signedRequest = signRequest(payload, signedAt, sharedSecret);

    expectVerificationErrorCode(
      () =>
        verifyHmacIntegrity(
          {
            snapshotPayload: payload,
            signatureVersion: HMAC_SIGNATURE_VERSION,
            signedAt,
            signature: signedRequest.signature,
            now,
          },
          { sharedSecret },
        ),
      'SIGNATURE_EXPIRED',
    );
  });

  it('allows signedAt at +60s skew boundary and rejects +61s', () => {
    const payload = { a: 1 };

    const withinSkewSignedAt = '2026-02-17T10:01:00.000Z';
    const withinSkewRequest = signRequest(payload, withinSkewSignedAt, sharedSecret);

    expect(() =>
      verifyHmacIntegrity(
        {
          snapshotPayload: payload,
          signatureVersion: HMAC_SIGNATURE_VERSION,
          signedAt: withinSkewSignedAt,
          signature: withinSkewRequest.signature,
          now,
        },
        { sharedSecret },
      ),
    ).not.toThrow();

    const overSkewSignedAt = '2026-02-17T10:01:01.000Z';
    const overSkewRequest = signRequest(payload, overSkewSignedAt, sharedSecret);

    expectVerificationErrorCode(
      () =>
        verifyHmacIntegrity(
          {
            snapshotPayload: payload,
            signatureVersion: HMAC_SIGNATURE_VERSION,
            signedAt: overSkewSignedAt,
            signature: overSkewRequest.signature,
            now,
          },
          { sharedSecret },
        ),
      'SIGNATURE_TIMESTAMP_INVALID',
    );
  });

  it('rejects tampered payload', () => {
    const originalPayload = { a: 1, b: 2 };
    const signedAt = '2026-02-17T09:59:20.000Z';
    const signedRequest = signRequest(originalPayload, signedAt, sharedSecret);

    const tamperedPayload = { a: 1, b: 3 };

    expectVerificationErrorCode(
      () =>
        verifyHmacIntegrity(
          {
            snapshotPayload: tamperedPayload,
            signatureVersion: HMAC_SIGNATURE_VERSION,
            signedAt,
            signature: signedRequest.signature,
            now,
          },
          { sharedSecret },
        ),
      'INVALID_SIGNATURE',
    );
  });

  it('rejects tampered signature', () => {
    const payload = { a: 1 };
    const signedAt = '2026-02-17T09:59:20.000Z';
    const signedRequest = signRequest(payload, signedAt, sharedSecret);

    const tamperedSignature = `${signedRequest.signature.slice(0, -1)}A`;

    expectVerificationErrorCode(
      () =>
        verifyHmacIntegrity(
          {
            snapshotPayload: payload,
            signatureVersion: HMAC_SIGNATURE_VERSION,
            signedAt,
            signature: tamperedSignature,
            now,
          },
          { sharedSecret },
        ),
      'INVALID_SIGNATURE',
    );
  });

  it('rejects missing shared secret', () => {
    const payload = { a: 1 };
    const signedAt = '2026-02-17T09:59:20.000Z';
    const signedRequest = signRequest(payload, signedAt, sharedSecret);

    expectVerificationErrorCode(
      () =>
        verifyHmacIntegrity(
          {
            snapshotPayload: payload,
            signatureVersion: HMAC_SIGNATURE_VERSION,
            signedAt,
            signature: signedRequest.signature,
            now,
          },
          { sharedSecret: '' },
        ),
      'INVALID_SIGNATURE',
    );
  });

  it('rejects payload containing unsupported number notation', () => {
    const payload = { amount: 1e-7 };
    const signedAt = '2026-02-17T09:59:20.000Z';

    expectVerificationErrorCode(
      () => signRequest(payload, signedAt, sharedSecret),
      'SNAPSHOT_CANONICALIZATION_FAILED',
    );
  });
});

function signRequest(
  snapshotPayload: unknown,
  signedAt: string,
  sharedSecret: string,
): {
  signature: string;
  payloadHash: string;
  signingString: string;
} {
  const canonicalPayload = canonicalizeSnapshotPayload(snapshotPayload);
  const payloadHash = computePayloadHash(canonicalPayload);
  const signingString = buildSigningString(
    HMAC_SIGNATURE_VERSION,
    signedAt,
    payloadHash,
  );
  const signature = computeHmacSignature(sharedSecret, signingString);

  return { signature, payloadHash, signingString };
}

function expectVerificationErrorCode(
  fn: () => void,
  expectedCode: HmacVerificationErrorCode,
): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HmacVerificationError);
    expect((error as HmacVerificationError).code).toBe(expectedCode);
    return;
  }

  throw new Error(`Expected HmacVerificationError(${expectedCode}) to be thrown`);
}
