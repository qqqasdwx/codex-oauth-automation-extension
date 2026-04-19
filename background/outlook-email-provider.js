(function attachOutlookEmailProvider(root, factory) {
  root.MultiPageOutlookEmailProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOutlookEmailProviderModule() {
  const root = typeof self !== 'undefined' ? self : globalThis;

  function createOutlookEmailProviderHelpers(deps = {}) {
    const {
      addLog,
      broadcastDataUpdate,
      fetch: fetchImpl = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      getState,
      pickVerificationMessageWithTimeFallback,
      setEmailState,
      setPersistentSettings,
      setState,
      sleepWithStop,
      throwIfStopped,
    } = deps;

    const outlookEmailUtils = root.OutlookEmailUtils || {};
    const OUTLOOK_EMAIL_PROVIDER = outlookEmailUtils.OUTLOOK_EMAIL_PROVIDER || 'outlookemail-api';
    const normalizeOutlookEmailAccount = outlookEmailUtils.normalizeOutlookEmailAccount || ((value) => value || null);
    const normalizeOutlookEmailAccounts = outlookEmailUtils.normalizeOutlookEmailAccounts || ((value) => Array.isArray(value) ? value : []);
    const normalizeOutlookEmailBaseUrl = outlookEmailUtils.normalizeOutlookEmailBaseUrl || ((value) => String(value || '').trim());
    const normalizeOutlookEmailGroupId = outlookEmailUtils.normalizeOutlookEmailGroupId || ((value) => String(value || '').trim());
    const normalizeOutlookEmailGroups = outlookEmailUtils.normalizeOutlookEmailGroups || ((value) => Array.isArray(value) ? value : []);
    const pickOutlookEmailAccountForRun = outlookEmailUtils.pickOutlookEmailAccountForRun
      || ((_accounts) => null);

    let sessionKey = '';
    let sessionAuthenticated = false;
    let cachedCsrfToken = '';

    function requireFetch() {
      if (typeof fetchImpl !== 'function') {
        throw new Error('OutlookEmail provider 缺少 fetch 实现。');
      }
      return fetchImpl;
    }

    function getErrorMessage(error) {
      return String(error?.message || error || '未知错误');
    }

    function getSessionKey(config = {}) {
      return `${config.baseUrl || ''}\n${config.password || ''}`;
    }

    function getOutlookEmailConfig(state = {}) {
      return {
        provider: String(state?.mailProvider || '').trim().toLowerCase(),
        baseUrl: normalizeOutlookEmailBaseUrl(state?.outlookEmailBaseUrl),
        password: String(state?.outlookEmailPassword || ''),
        sourceGroupId: normalizeOutlookEmailGroupId(state?.outlookEmailSourceGroupId),
        successGroupId: normalizeOutlookEmailGroupId(state?.outlookEmailSuccessGroupId),
      };
    }

    function ensureOutlookEmailBaseConfig(config = {}) {
      if (!config.baseUrl) {
        throw new Error('OutlookEmail 服务地址为空或无效。');
      }
      if (!config.password) {
        throw new Error('OutlookEmail 登录密码为空。');
      }
      return config;
    }

    function buildOutlookEmailUrl(baseUrl, path, searchParams = null) {
      const url = new URL(path, `${baseUrl}/`);
      if (searchParams && typeof searchParams === 'object') {
        for (const [key, value] of Object.entries(searchParams)) {
          if (value === undefined || value === null || value === '') continue;
          url.searchParams.set(key, String(value));
        }
      }
      return url.toString();
    }

    async function parseJsonResponse(response) {
      const text = await response.text();
      if (!text) {
        return {};
      }

      try {
        return JSON.parse(text);
      } catch {
        return {
          success: response.ok,
          raw: text,
          message: text,
        };
      }
    }

    function extractApiError(payload, fallback = '') {
      if (payload?.error) {
        if (typeof payload.error === 'string') {
          return payload.error;
        }
        if (typeof payload.error === 'object') {
          return payload.error.message || payload.error.detail || JSON.stringify(payload.error);
        }
      }
      if (payload?.message) {
        return String(payload.message);
      }
      if (payload?.raw) {
        return String(payload.raw);
      }
      return String(fallback || '请求失败');
    }

    async function loginOutlookEmail(options = {}) {
      const state = options.state || await getState();
      const config = ensureOutlookEmailBaseConfig(getOutlookEmailConfig(state));
      const fetcher = requireFetch();

      const response = await fetcher(buildOutlookEmailUrl(config.baseUrl, '/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ password: config.password }),
        credentials: 'include',
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok || payload?.success === false) {
        sessionAuthenticated = false;
        cachedCsrfToken = '';
        throw new Error(`OutlookEmail 登录失败：${extractApiError(payload, `HTTP ${response.status}`)}`);
      }

      sessionAuthenticated = true;
      sessionKey = getSessionKey(config);
      cachedCsrfToken = '';
      return {
        success: true,
        baseUrl: config.baseUrl,
      };
    }

    async function ensureOutlookEmailSession(state = null, options = {}) {
      const config = ensureOutlookEmailBaseConfig(getOutlookEmailConfig(state || await getState()));
      if (!options.force && sessionAuthenticated && sessionKey === getSessionKey(config)) {
        return config;
      }

      await loginOutlookEmail({ state: { ...state, ...config } });
      return config;
    }

    async function ensureOutlookEmailCsrfToken(options = {}) {
      const state = options.state || await getState();
      const config = await ensureOutlookEmailSession(state, options);
      if (!options.force && cachedCsrfToken && sessionKey === getSessionKey(config)) {
        return cachedCsrfToken;
      }

      const fetcher = requireFetch();
      const response = await fetcher(buildOutlookEmailUrl(config.baseUrl, '/api/csrf-token'), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        credentials: 'include',
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(`获取 OutlookEmail CSRF Token 失败：${extractApiError(payload, `HTTP ${response.status}`)}`);
      }

      cachedCsrfToken = payload?.csrf_disabled ? '' : String(payload?.csrf_token || '');
      return cachedCsrfToken;
    }

    async function requestOutlookEmailJson(path, options = {}) {
      const {
        method = 'GET',
        state = null,
        searchParams = null,
        jsonData,
        retryOnUnauthorized = true,
        useCsrf = false,
        actionLabel = '请求 OutlookEmail 服务',
      } = options;
      const config = await ensureOutlookEmailSession(state, options);
      const fetcher = requireFetch();
      const headers = {
        Accept: 'application/json',
      };
      if (jsonData !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      if (useCsrf) {
        const csrfToken = await ensureOutlookEmailCsrfToken({ state, force: options.forceCsrf });
        if (csrfToken) {
          headers['X-CSRFToken'] = csrfToken;
        }
      }

      const response = await fetcher(buildOutlookEmailUrl(config.baseUrl, path, searchParams), {
        method,
        headers,
        body: jsonData !== undefined ? JSON.stringify(jsonData) : undefined,
        credentials: 'include',
      });
      const payload = await parseJsonResponse(response);

      if ((response.status === 401 || payload?.need_login) && retryOnUnauthorized) {
        await loginOutlookEmail({ state: { ...state, ...config } });
        return requestOutlookEmailJson(path, {
          ...options,
          retryOnUnauthorized: false,
        });
      }

      if (!response.ok || payload?.success === false) {
        if (useCsrf && response.status === 400 && retryOnUnauthorized) {
          cachedCsrfToken = '';
        }
        throw new Error(`${actionLabel}失败：${extractApiError(payload, `HTTP ${response.status}`)}`);
      }

      return payload;
    }

    function normalizeMailFolder(folder = '') {
      const normalized = String(folder || '').trim().toLowerCase();
      if (normalized === 'junkemail') return 'Junk';
      if (normalized === 'deleteditems') return 'Deleted';
      return 'INBOX';
    }

    function normalizeOutlookEmailMessage(message = {}) {
      const id = String(message.id || '').trim();
      if (!id) return null;

      return {
        id,
        subject: String(message.subject || '').trim(),
        from: {
          emailAddress: {
            address: String(message.from || '').trim(),
          },
        },
        bodyPreview: String(message.body_preview || message.bodyPreview || '').trim(),
        receivedDateTime: String(message.date || message.receivedDateTime || '').trim(),
        mailbox: normalizeMailFolder(message.folder),
      };
    }

    async function setOutlookEmailGroupsState(groups) {
      const normalizedGroups = normalizeOutlookEmailGroups(groups);
      await Promise.all([
        setState({ outlookEmailGroups: normalizedGroups }),
        typeof setPersistentSettings === 'function'
          ? setPersistentSettings({ outlookEmailGroups: normalizedGroups })
          : Promise.resolve(),
      ]);
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate({ outlookEmailGroups: normalizedGroups });
      }
      return normalizedGroups;
    }

    async function setOutlookEmailAccountsState(accounts) {
      const normalizedAccounts = normalizeOutlookEmailAccounts(accounts);
      await setState({ outlookEmailAccounts: normalizedAccounts });
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate({ outlookEmailAccounts: normalizedAccounts });
      }
      return normalizedAccounts;
    }

    function getOutlookEmailUsedAccountIds(state = {}) {
      return [...new Set((Array.isArray(state?.outlookEmailUsedAccountIds) ? state.outlookEmailUsedAccountIds : [])
        .map((value) => normalizeOutlookEmailGroupId(value))
        .filter(Boolean))];
    }

    async function setOutlookEmailUsedAccountIdsState(accountIds) {
      const normalizedAccountIds = [...new Set((Array.isArray(accountIds) ? accountIds : [])
        .map((value) => normalizeOutlookEmailGroupId(value))
        .filter(Boolean))];
      await setState({ outlookEmailUsedAccountIds: normalizedAccountIds });
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate({ outlookEmailUsedAccountIds: normalizedAccountIds });
      }
      return normalizedAccountIds;
    }

    async function markOutlookEmailAccountUsed(accountId) {
      const normalizedAccountId = normalizeOutlookEmailGroupId(accountId);
      if (!normalizedAccountId) {
        return [];
      }
      const state = await getState();
      const usedAccountIds = getOutlookEmailUsedAccountIds(state);
      if (!usedAccountIds.includes(normalizedAccountId)) {
        usedAccountIds.push(normalizedAccountId);
      }
      return setOutlookEmailUsedAccountIdsState(usedAccountIds);
    }

    function getCurrentOutlookEmailAccount(state = {}) {
      const currentId = normalizeOutlookEmailGroupId(state?.currentOutlookEmailAccountId);
      if (!currentId) {
        return null;
      }
      return normalizeOutlookEmailAccounts(state?.outlookEmailAccounts).find((account) => account.id === currentId) || null;
    }

    async function setCurrentOutlookEmailAccount(accountId, options = {}) {
      const state = options.state || await getState();
      const normalizedAccountId = normalizeOutlookEmailGroupId(accountId);
      const accounts = normalizeOutlookEmailAccounts(options.accounts !== undefined ? options.accounts : state?.outlookEmailAccounts);
      const account = accounts.find((item) => item.id === normalizedAccountId);
      if (!account) {
        throw new Error('未找到对应的 OutlookEmail 账号。');
      }

      await setState({
        currentOutlookEmailAccountId: account.id,
        outlookEmailAccounts: accounts,
      });
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate({
          currentOutlookEmailAccountId: account.id,
          outlookEmailAccounts: accounts,
        });
      }
      if (options.syncEmail !== false) {
        await setEmailState(account.email || null);
      }
      return account;
    }

    async function clearOutlookEmailRuntimeState(options = {}) {
      const state = options.state || await getState();
      const removeAccountId = normalizeOutlookEmailGroupId(options.removeAccountId);
      const nextAccounts = removeAccountId
        ? normalizeOutlookEmailAccounts(state?.outlookEmailAccounts).filter((account) => account.id !== removeAccountId)
        : normalizeOutlookEmailAccounts(state?.outlookEmailAccounts);

      await setState({
        currentOutlookEmailAccountId: null,
        outlookEmailAccounts: nextAccounts,
      });
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate({
          currentOutlookEmailAccountId: null,
          outlookEmailAccounts: nextAccounts,
        });
      }
      if (options.clearEmail) {
        await setEmailState(null);
      }
    }

    async function fetchOutlookEmailGroups(options = {}) {
      const state = options.state || await getState();
      const payload = await requestOutlookEmailJson('/api/groups', {
        state,
        actionLabel: '拉取 OutlookEmail 分组',
      });
      return setOutlookEmailGroupsState(payload?.groups || []);
    }

    async function fetchOutlookEmailAccounts(groupId, options = {}) {
      const state = options.state || await getState();
      const normalizedGroupId = normalizeOutlookEmailGroupId(groupId ?? state?.outlookEmailSourceGroupId);
      if (!normalizedGroupId) {
        throw new Error('OutlookEmail 注册邮箱池分组未配置。');
      }

      const payload = await requestOutlookEmailJson('/api/accounts', {
        state,
        searchParams: { group_id: normalizedGroupId },
        actionLabel: '拉取 OutlookEmail 账号列表',
      });
      const accounts = normalizeOutlookEmailAccounts(payload?.accounts || []);
      if (options.updateState !== false) {
        await setOutlookEmailAccountsState(accounts);
      }
      return accounts;
    }

    async function fetchOutlookEmailMessages(email, options = {}) {
      const state = options.state || await getState();
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        throw new Error('OutlookEmail 邮箱地址为空。');
      }

      const payload = await requestOutlookEmailJson(`/api/emails/${encodeURIComponent(normalizedEmail)}`, {
        state,
        searchParams: {
          folder: options.folder || 'all',
          top: Number(options.top) || 10,
        },
        actionLabel: '拉取 OutlookEmail 邮件',
      });

      return {
        method: String(payload?.method || '').trim(),
        hasMore: Boolean(payload?.has_more),
        partial: Boolean(payload?.partial),
        details: payload?.details || null,
        messages: (Array.isArray(payload?.emails) ? payload.emails : [])
          .map(normalizeOutlookEmailMessage)
          .filter(Boolean),
      };
    }

    async function moveOutlookEmailAccountsToGroup(accountIds, groupId, options = {}) {
      const state = options.state || await getState();
      const normalizedAccountIds = [...new Set((Array.isArray(accountIds) ? accountIds : [])
        .map((value) => Number(normalizeOutlookEmailGroupId(value)) || 0)
        .filter((value) => value > 0))];
      const normalizedGroupId = Number(normalizeOutlookEmailGroupId(groupId)) || 0;

      if (!normalizedAccountIds.length) {
        throw new Error('没有可移动的 OutlookEmail 账号。');
      }
      if (!normalizedGroupId) {
        throw new Error('OutlookEmail 目标分组未配置。');
      }

      return requestOutlookEmailJson('/api/accounts/batch-update-group', {
        state,
        method: 'POST',
        jsonData: {
          account_ids: normalizedAccountIds,
          group_id: normalizedGroupId,
        },
        useCsrf: true,
        actionLabel: '移动 OutlookEmail 账号分组',
      });
    }

    async function ensureOutlookEmailAccountForFlow(options = {}) {
      const state = options.state || await getState();
      const accounts = await fetchOutlookEmailAccounts(state?.outlookEmailSourceGroupId, {
        state,
        updateState: true,
      });
      const usedAccountIds = getOutlookEmailUsedAccountIds(state);
      const account = pickOutlookEmailAccountForRun(accounts, {
        preferredAccountId: options.preferredAccountId || state?.currentOutlookEmailAccountId,
        currentAccountId: state?.currentOutlookEmailAccountId,
        excludeIds: usedAccountIds,
      });

      if (!account) {
        throw new Error('OutlookEmail 邮箱池分组中没有可用账号。');
      }

      return setCurrentOutlookEmailAccount(account.id, {
        state,
        accounts,
        syncEmail: options.syncEmail !== false,
      });
    }

    async function pollOutlookEmailVerificationCode(step, state, pollPayload = {}) {
      const latestState = state || await getState();
      const account = await ensureOutlookEmailAccountForFlow({
        state: latestState,
        preferredAccountId: latestState?.currentOutlookEmailAccountId || null,
        syncEmail: true,
      });
      const maxAttempts = Math.max(1, Number(pollPayload.maxAttempts) || 5);
      const intervalMs = Math.max(1, Number(pollPayload.intervalMs) || 3000);
      const top = Math.max(10, Math.min(50, Number(pollPayload.top) || 10));
      let lastError = null;

      await addLog(`步骤 ${step}：当前使用 OutlookEmail 账号 ${account.email} 轮询邮箱。`, 'info');

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        throwIfStopped();
        try {
          await addLog(`步骤 ${step}：正在通过 OutlookEmail 轮询验证码（${attempt}/${maxAttempts}）...`, 'info');
          const result = await fetchOutlookEmailMessages(account.email, {
            state: latestState,
            folder: 'all',
            top,
          });
          const matchResult = pickVerificationMessageWithTimeFallback(result.messages, {
            afterTimestamp: Number(pollPayload.filterAfterTimestamp || 0) || 0,
            senderFilters: pollPayload.senderFilters || [],
            subjectFilters: pollPayload.subjectFilters || [],
            excludeCodes: pollPayload.excludeCodes || [],
          });
          const match = matchResult?.match || null;

          if (match?.code) {
            const mailboxLabel = match.message?.mailbox || 'INBOX';
            if (matchResult.usedTimeFallback) {
              await addLog(`步骤 ${step}：OutlookEmail 使用时间回退后命中 ${mailboxLabel} 验证码。`, 'warn');
            }
            await addLog(`步骤 ${step}：已通过 OutlookEmail 在 ${mailboxLabel} 中找到验证码：${match.code}`, 'ok');
            return {
              ok: true,
              code: match.code,
              emailTimestamp: match.receivedAt || Date.now(),
              mailId: match.message?.id || '',
            };
          }

          lastError = new Error(`步骤 ${step}：OutlookEmail 邮箱轮询结束，但未获取到验证码。`);
          await addLog(lastError.message, attempt === maxAttempts ? 'warn' : 'info');
        } catch (error) {
          lastError = error;
          await addLog(`步骤 ${step}：OutlookEmail 轮询失败：${getErrorMessage(error)}`, 'warn');
        }

        if (attempt < maxAttempts) {
          await sleepWithStop(intervalMs);
        }
      }

      throw lastError || new Error(`步骤 ${step}：OutlookEmail 未返回新的匹配验证码。`);
    }

    async function finalizeOutlookEmailAfterSuccessfulFlow(state = null) {
      const latestState = state || await getState();
      if (String(latestState?.mailProvider || '').trim().toLowerCase() !== OUTLOOK_EMAIL_PROVIDER) {
        return null;
      }

      const currentAccount = getCurrentOutlookEmailAccount(latestState)
        || normalizeOutlookEmailAccount({
          id: latestState?.currentOutlookEmailAccountId,
          email: latestState?.email,
        });
      if (!currentAccount?.id) {
        return null;
      }

      let moveError = null;
      try {
        const successGroupId = normalizeOutlookEmailGroupId(latestState?.outlookEmailSuccessGroupId);
        if (!successGroupId) {
          throw new Error('OutlookEmail 注册成功分组未配置。');
        }
        await moveOutlookEmailAccountsToGroup([currentAccount.id], successGroupId, {
          state: latestState,
        });
      } catch (error) {
        moveError = error;
      } finally {
        await markOutlookEmailAccountUsed(currentAccount.id);
        await clearOutlookEmailRuntimeState({
          state: latestState,
          clearEmail: true,
          removeAccountId: currentAccount.id,
        });
      }

      if (moveError) {
        throw moveError;
      }

      return currentAccount;
    }

    return {
      OUTLOOK_EMAIL_PROVIDER,
      clearOutlookEmailRuntimeState,
      ensureOutlookEmailAccountForFlow,
      ensureOutlookEmailCsrfToken,
      fetchOutlookEmailAccounts,
      fetchOutlookEmailGroups,
      fetchOutlookEmailMessages,
      finalizeOutlookEmailAfterSuccessfulFlow,
      getCurrentOutlookEmailAccount,
      getOutlookEmailConfig,
      getOutlookEmailUsedAccountIds,
      loginOutlookEmail,
      markOutlookEmailAccountUsed,
      moveOutlookEmailAccountsToGroup,
      pollOutlookEmailVerificationCode,
      requestOutlookEmailJson,
      setCurrentOutlookEmailAccount,
    };
  }

  return {
    createOutlookEmailProviderHelpers,
  };
});
