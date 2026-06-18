(function () {
  const log = (content) => {
    console.log('[Migrator]', content);
  };

  log('bootstrap');

  const memberIdEl = document.getElementById('member-id');
  const memberNameEl = document.getElementById('member-name');
  const errorEl = document.getElementById('migrate-error');
  const continueBtn = document.getElementById('continue-btn');
  const cardEl = document.querySelector('.card');
  const protocolRegex = new RegExp('^https?://', 'i');

  const params = new URLSearchParams(window.location.search);

  const rootEl = document.getElementById('migrate-root');
  const rootDataset = rootEl ? rootEl.dataset : {};
  const config = window.CAFE24_MIGRATION_CONFIG || {};
  const clientId = 'ttE1ehvFAqzFp2HetA0d6P';
  log({ rootDataset, hasConfig: Boolean(window.CAFE24_MIGRATION_CONFIG) });

  const redirectUrl =
    params.get('redirect_to') ||
    rootDataset.redirectTo ||
    config.redirectTo ||
    '';
  const apiBase = 'https://user.almondyoung-next.com';
  const memberInfoPath = '/cafe24/member-info';

  const memberInfoUrl = resolveApiUrl(apiBase, memberInfoPath);
  log({
    redirectUrl,
    apiBase,
    memberInfoUrl,
  });

  let encryptedIdToken = '';

  memberIdEl.textContent = '불러오는 중';
  memberNameEl.textContent = '불러오는 중';
  continueBtn.disabled = true;
  setLoading(true);

  if (!redirectUrl) {
    setError('이동 경로(redirect_to)를 확인할 수 없어요.');
    log('missing redirect_to');
    return;
  }

  if (!memberInfoUrl) {
    setError('API 경로를 확인할 수 없어요. 관리자에게 문의해 주세요.');
    log('missing api url');
    return;
  }

  initialize();

  continueBtn.addEventListener('click', async () => {
    clearError();
    setBusy(true, '연결 정보를 준비하는 중...');

    try {
      if (!encryptedIdToken) {
        throw new Error('암호화 id 토큰이 없습니다.');
      }

      log('redirect to storefront');
      const targetUrl = new URL(redirectUrl);
      targetUrl.searchParams.set('encrypted_id_token', encryptedIdToken);
      window.location.href = targetUrl.toString();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      setBusy(false);
    }
  });

  function setBusy(isBusy, label, keepDisabled) {
    log({ action: 'setBusy', isBusy, label, keepDisabled });
    if (isBusy) {
      continueBtn.disabled = true;
      continueBtn.textContent = label || '연결 정보를 확인 중...';
      return;
    }

    if (!keepDisabled) {
      continueBtn.disabled = false;
    }
    continueBtn.textContent = '계정 연결하고 이동';
  }

  function setError(message) {
    log({ action: 'setError', message });
    errorEl.textContent = message;
    errorEl.classList.add('active');
    setLoading(false);
  }

  function clearError() {
    log('clearError');
    errorEl.textContent = '';
    errorEl.classList.remove('active');
  }

  function setLoading(isLoading) {
    log({ action: 'setLoading', isLoading });
    if (!cardEl) {
      log('missing card element');
      return;
    }
    cardEl.classList.toggle('is-loading', isLoading);
  }

  async function initialize() {
    try {
      log('initialize start');
      setLoading(true);
      setBusy(true, '회원 정보를 불러오는 중...');
      const encrypted = await fetchEncryptedMemberId(config);
      log({ encryptedMemberId: encrypted.memberId, guestId: encrypted.guestId });
      if (!encrypted.memberId) {
        log('guest detected, redirect to login');
        window.location.href = buildLoginRedirectUrl();
        return;
      }

      encryptedIdToken = encrypted.memberId;

      log('fetch member info');
      const memberInfo = await fetchMemberInfo(memberInfoUrl, {
        encryptedIdToken,
      });

      log({ memberInfo });
      memberIdEl.textContent = memberInfo.memberId || '확인 필요';
      memberNameEl.textContent = memberInfo.memberName || '확인 필요';
      continueBtn.disabled = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log({ action: 'initialize error', message });
      setError(message);
      memberIdEl.textContent = '확인 필요';
      memberNameEl.textContent = '확인 필요';
      continueBtn.disabled = true;
      setBusy(false, '', true);
    } finally {
      log('initialize done');
      setLoading(false);
      if (!continueBtn.disabled) {
        setBusy(false);
      }
    }
  }

  function fetchEncryptedMemberId(configValue) {
    return new Promise((resolve, reject) => {
      log('fetchEncryptedMemberId');
      if (!window.CAFE24API) {
        reject(new Error('CAFE24API를 찾을 수 없습니다.'));
        return;
      }

      const apiVersion = configValue.apiVersion || '2025-12-01';

      log({ action: 'init cafe24 api', apiVersion });
      const api = window.CAFE24API.init({
        client_id: clientId,
        version: apiVersion,
      });

      if (!api || typeof api.getEncryptedMemberId !== 'function') {
        reject(new Error('Cafe24 API 초기화에 실패했습니다.'));
        return;
      }

      api.getEncryptedMemberId(clientId, (err, res) => {
        if (err) {
          const status = err.status || err.statusCode || err.code;
          const message = err && (err.message || String(err));
          log({ action: 'getEncryptedMemberId error', status, message, err });
          if (
            status === 403 ||
            status === '403' ||
            message === '403' ||
            String(err).includes('403')
          ) {
            log('getEncryptedMemberId 403, redirect to login');
            window.location.href = buildLoginRedirectUrl();
            return;
          }
          reject(new Error(message || '회원 정보 확인에 실패했습니다.'));
          return;
        }

        log({ action: 'getEncryptedMemberId success' });
        resolve({
          memberId: res.member_id,
          guestId: res.guest_id,
        });
      });
    });
  }

  async function fetchMemberInfo(url, payload) {
    log({ action: 'fetchMemberInfo', url });
    const data = await postJson(url, payload);
    return {
      memberId: data.memberId || data.member_id || data.user_id || '',
      memberName: data.memberName || data.member_name || data.name || '',
    };
  }

  async function postJson(url, payload) {
    log({ action: 'postJson', url, payloadKeys: Object.keys(payload || {}) });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      log({ action: 'postJson error', status: response.status, body });
      const message =
        body?.message || body?.error || '요청에 실패했습니다.';
      throw new Error(message);
    }

    log({ action: 'postJson success', status: response.status });
    return body && body.data !== undefined ? body.data : body;
  }

  function resolveApiUrl(base, path) {
    if (!path) {
      return '';
    }
    if (protocolRegex.test(path)) {
      return path;
    }
    const trimmedBase = base ? base.replace(/\/$/, '') : '';
    if (!trimmedBase) {
      return '';
    }
    const trimmedPath = path.startsWith('/') ? path : `/${path}`;
    return `${trimmedBase}${trimmedPath}`;
  }

  function postRedirect(url, fields) {
    log({ action: 'postRedirect', url, fieldKeys: Object.keys(fields || {}) });
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;

    Object.keys(fields).forEach((key) => {
      if (fields[key] === undefined) {
        return;
      }

      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = fields[key] === null ? '' : String(fields[key]);
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
  }

  function buildLoginRedirectUrl() {
    const path = window.location.pathname || '/';
    const query = window.location.search || '';
    const hash = window.location.hash || '';
    const returnUrl = `${path}${query}${hash}`;
    return `https://almondyoung.com/member/login.html?returnUrl=${encodeURIComponent(returnUrl)}`;
  }
})();
