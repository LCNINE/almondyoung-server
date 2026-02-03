(function () {
  const memberIdEl = document.getElementById('member-id');
  const memberNameEl = document.getElementById('member-name');
  const errorEl = document.getElementById('migrate-error');
  const continueBtn = document.getElementById('continue-btn');
  const cardEl = document.querySelector('.card');

  const params = new URLSearchParams(window.location.search);

  const rootEl = document.getElementById('migrate-root');
  const rootDataset = rootEl ? rootEl.dataset : {};
  const config = window.CAFE24_MIGRATION_CONFIG || {};

  const redirectUrl =
    params.get('redirect_to') ||
    rootDataset.redirectTo ||
    config.redirectTo ||
    '';
  const apiBase =
    params.get('api_base') || rootDataset.apiBase || config.apiBase || '';
  const memberInfoPath =
    params.get('member_info_path') ||
    rootDataset.memberInfoPath ||
    config.memberInfoPath ||
    '/cafe24/member-info';
  const linkTokenPath =
    params.get('link_token_path') ||
    rootDataset.linkTokenPath ||
    config.linkTokenPath ||
    '/cafe24/link-token';
  const mallId =
    params.get('mall_id') || rootDataset.mallId || config.mallId || '';

  const memberInfoUrl = resolveApiUrl(apiBase, memberInfoPath);
  const linkTokenUrl = resolveApiUrl(apiBase, linkTokenPath);

  let encryptedIdToken = '';

  memberIdEl.textContent = '불러오는 중';
  memberNameEl.textContent = '불러오는 중';
  continueBtn.disabled = true;
  setLoading(true);

  if (!redirectUrl) {
    setError('이동 경로(redirect_to)를 확인할 수 없어요.');
    return;
  }

  if (!memberInfoUrl || !linkTokenUrl) {
    setError('API 경로를 확인할 수 없어요. 관리자에게 문의해 주세요.');
    return;
  }

  initialize();

  continueBtn.addEventListener('click', async () => {
    clearError();
    setBusy(true, '링크 토큰 발급 중...');

    try {
      if (!encryptedIdToken) {
        throw new Error('암호화 id 토큰이 없습니다.');
      }

      const issued = await issueLinkToken(linkTokenUrl, {
        encryptedIdToken,
        mallId,
      });

      postRedirect(redirectUrl, {
        cafe24_link_token: issued.cafe24LinkToken,
        expires_at: issued.expiresAt,
        mall_id: mallId || undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      setBusy(false);
    }
  });

  function setBusy(isBusy, label, keepDisabled) {
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
    errorEl.textContent = message;
    errorEl.classList.add('active');
    setLoading(false);
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.remove('active');
  }

  function setLoading(isLoading) {
    if (!cardEl) {
      return;
    }
    cardEl.classList.toggle('is-loading', isLoading);
  }

  async function initialize() {
    try {
      setLoading(true);
      setBusy(true, '회원 정보를 불러오는 중...');
      const encrypted = await fetchEncryptedMemberId(config, params);
      encryptedIdToken = encrypted.memberId;

      const memberInfo = await fetchMemberInfo(memberInfoUrl, {
        encryptedIdToken,
        mallId: encrypted.mallId || mallId,
      });

      memberIdEl.textContent = memberInfo.memberId || '확인 필요';
      memberNameEl.textContent = memberInfo.memberName || '확인 필요';
      continueBtn.disabled = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      memberIdEl.textContent = '확인 필요';
      memberNameEl.textContent = '확인 필요';
      continueBtn.disabled = true;
      setBusy(false, '', true);
    } finally {
      setLoading(false);
      if (!continueBtn.disabled) {
        setBusy(false);
      }
    }
  }

  function fetchEncryptedMemberId(configValue, paramsValue) {
    return new Promise((resolve, reject) => {
      if (!window.CAFE24API) {
        reject(new Error('CAFE24API를 찾을 수 없습니다.'));
        return;
      }

      const appKey = configValue.appKey || configValue.clientId || paramsValue.get('app_key') || paramsValue.get('client_id');
      const apiVersion =
        configValue.apiVersion || paramsValue.get('api_version') || '2025-12-01';
      const serviceKey =
        configValue.serviceKey || paramsValue.get('service_key');
      const mallId = configValue.mallId || paramsValue.get('mall_id');

      if (!appKey || !serviceKey) {
        reject(new Error('Cafe24 API 설정값이 부족합니다. (appKey 또는 serviceKey)'));
        return;
      }

      const api = window.CAFE24API.init({
        client_id: appKey,
        version: apiVersion,
      });

      if (!api || typeof api.getEncryptedMemberId !== 'function') {
        reject(new Error('Cafe24 API 초기화에 실패했습니다.'));
        return;
      }

      api.getEncryptedMemberId(serviceKey, (err, res) => {
        if (err) {
          reject(new Error(err.message || '회원 정보 확인에 실패했습니다.'));
          return;
        }

        resolve({
          memberId: res.member_id,
          guestId: res.guest_id,
          mallId,
        });
      });
    });
  }

  async function fetchMemberInfo(url, payload) {
    const data = await postJson(url, payload);
    return {
      memberId: data.memberId || data.member_id || data.user_id || '',
      memberName: data.memberName || data.member_name || data.name || '',
    };
  }

  async function issueLinkToken(url, payload) {
    const data = await postJson(url, payload);
    return {
      cafe24LinkToken: data.cafe24LinkToken || data.cafe24_link_token,
      expiresAt: data.expiresAt || data.expires_at,
    };
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        body?.message || body?.error || '요청에 실패했습니다.';
      throw new Error(message);
    }

    return body && body.data !== undefined ? body.data : body;
  }

  const protocolRegex = new RegExp('^https?://', 'i');

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
})();
