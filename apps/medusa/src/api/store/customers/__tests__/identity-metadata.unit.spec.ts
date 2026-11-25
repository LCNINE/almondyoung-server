import { creationMetadata, updateMetadataPatch } from '../identity-metadata';

describe('creationMetadata', () => {
  it('takes the identity from the verified login, not from the body', () => {
    const metadata = creationMetadata(
      { almond_user_id: 'someone-else', almond_login_id: 'victim', withdrawn_at: '2026-01-01', marketing: true },
      { user_id: 'me', login_id: 'my-login', email: 'me@example.com' },
    );

    expect(metadata).toEqual({ almond_user_id: 'me', almond_login_id: 'my-login', marketing: true });
  });

  it('rejects when the login has no user id', () => {
    expect(() => creationMetadata({ almond_user_id: 'someone-else' }, {})).toThrow('Login identity has no user id');
  });
});

describe('updateMetadataPatch', () => {
  it('drops identity keys so the stored values stay (Medusa merges metadata)', () => {
    const patch = updateMetadataPatch({
      almond_user_id: 'someone-else',
      almond_login_id: '',
      withdrawn_at: null,
      nickname: 'new',
    });

    expect(patch).toEqual({ nickname: 'new' });
  });

  it('does not send a top-level null that would wipe all metadata', () => {
    expect(updateMetadataPatch(null)).toBeUndefined();
    expect(updateMetadataPatch(undefined)).toBeUndefined();
  });
});
