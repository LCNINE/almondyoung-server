(function () {
  const memberIdEl = document.getElementById('member-id');
  const memberNameEl = document.getElementById('member-name');
  const errorEl = document.getElementById('migrate-error');
  const continueBtn = document.getElementById('continue-btn');

  const params = new URLSearchParams(window.location.search);
  const flow = (params.get('flow') || 'link').toLowerCase();

  const rootEl = document.getElementById('migrate-root');
  const rootDataset = rootEl ? rootEl.dataset : {};
  const displayMemberId =
    params.get('member_id') || rootDataset.memberId || '';
  const displayMemberName =
    params.get('member_name') || rootDataset.memberName || '';

  const config = window.CAFE24_MIGRATION_CONFIG || {};

  const redirectUrl = resolveRedirectUrl({
    flow,
    returnTo: params.get('return_to') || config.returnTo,
    base: params.get('base') || config.base,
    signupPath: params.get('signup_path') || config.signupPath,
    linkPath: params.get('link_path') || config.linkPath,
  });

  if (displayMemberId) {
    memberIdEl.textContent = displayMemberId;
  }

  if (displayMemberName) {
    memberNameEl.textContent = displayMemberName;
  }

  if (!displayMemberId) {
    memberIdEl.textContent = '확인 필요';
  }

  if (!displayMemberName) {
    memberNameEl.textContent = '확인 필요';
  }

  if (!redirectUrl) {
    setError(
      '이동 경로를 확인할 수 없어요. 관리자에게 문의해 주세요.',
    );
    continueBtn.disabled = true;
    return;
  }

  continueBtn.addEventListener('click', async () => {
    clearError();
    setBusy(true);

    try {
      const encrypted = await fetchEncryptedMemberId(config, params);
      const payload = {
        flow,
        encrypted_member_id: encrypted.memberId,
        guest_id: encrypted.guestId || null,
        mall_id: encrypted.mallId || null,
        ts: new Date().toISOString(),
      };

      postRedirect(redirectUrl, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      setBusy(false);
    }
  });

  function setBusy(isBusy) {
    continueBtn.disabled = isBusy;
    continueBtn.textContent = isBusy
      ? '연결 정보를 확인 중...'
      : '계정 연결하고 이동';
  }

  function setError(message) {
    errorEl.textContent = message;
    errorEl.classList.add('active');
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.remove('active');
  }

  function resolveRedirectUrl({
    flow: flowValue,
    returnTo,
    base,
    signupPath,
    linkPath,
  }) {
    if (returnTo) {
      return returnTo;
    }

    const trimmedBase = base ? base.replace(/\/$/, '') : '';
    if (!trimmedBase) {
      return '';
    }

    const defaultSignupPath = '/migrate/signup';
    const defaultLinkPath = '/migrate/link';
    const path = flowValue === 'signup'
      ? signupPath || defaultSignupPath
      : linkPath || defaultLinkPath;

    return `${trimmedBase}${path}`;
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
