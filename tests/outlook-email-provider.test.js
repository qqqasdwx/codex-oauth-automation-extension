const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test('outlook email provider logs in and fetches groups through existing web api', async () => {
  const source = fs.readFileSync('background/outlook-email-provider.js', 'utf8');
  const globalScope = {
    OutlookEmailUtils: require('../outlook-email-utils.js'),
  };
  const api = new Function('self', `${source}; return self.MultiPageOutlookEmailProvider;`)(globalScope);

  const calls = [];
  let state = {
    mailProvider: 'outlookemail-api',
    outlookEmailBaseUrl: 'http://127.0.0.1:5000/login',
    outlookEmailPassword: 'secret',
    outlookEmailGroups: [],
  };
  const persisted = [];
  const broadcasts = [];
  const helpers = api.createOutlookEmailProviderHelpers({
    addLog: async () => {},
    broadcastDataUpdate: (payload) => broadcasts.push(payload),
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === 'http://127.0.0.1:5000/login') {
        return createJsonResponse({ success: true, message: '登录成功' });
      }
      if (url === 'http://127.0.0.1:5000/api/groups') {
        return createJsonResponse({
          success: true,
          groups: [{ id: 1, name: '注册池', account_count: 2 }],
        });
      }
      throw new Error(`unexpected request: ${url}`);
    },
    getState: async () => state,
    pickVerificationMessageWithTimeFallback: () => ({ match: null }),
    setEmailState: async () => {},
    setPersistentSettings: async (payload) => {
      persisted.push(payload);
      state = { ...state, ...payload };
    },
    setState: async (payload) => {
      state = { ...state, ...payload };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const groups = await helpers.fetchOutlookEmailGroups();

  assert.deepStrictEqual(groups, [{
    id: '1',
    name: '注册池',
    color: '#666666',
    accountCount: 2,
    description: '',
    isSystem: false,
    sortPosition: null,
  }]);
  assert.deepStrictEqual(calls.map((item) => item.url), [
    'http://127.0.0.1:5000/login',
    'http://127.0.0.1:5000/api/groups',
  ]);
  assert.deepStrictEqual(persisted, [{
    outlookEmailGroups: groups,
  }]);
  assert.deepStrictEqual(broadcasts, [{
    outlookEmailGroups: groups,
  }]);
  assert.deepStrictEqual(state.outlookEmailGroups, groups);
});

test('outlook email provider refreshes groups after successful account move', async () => {
  const source = fs.readFileSync('background/outlook-email-provider.js', 'utf8');
  const globalScope = {
    OutlookEmailUtils: require('../outlook-email-utils.js'),
  };
  const api = new Function('self', `${source}; return self.MultiPageOutlookEmailProvider;`)(globalScope);

  const calls = [];
  let state = {
    mailProvider: 'outlookemail-api',
    outlookEmailBaseUrl: 'http://127.0.0.1:5000/login',
    outlookEmailPassword: 'secret',
    outlookEmailSuccessGroupId: '2',
    currentOutlookEmailAccountId: '11',
    email: 'demo@example.com',
    outlookEmailUsedAccountIds: [],
    outlookEmailGroups: [{
      id: '1',
      name: '注册池',
      color: '#666666',
      accountCount: 2,
      description: '',
      isSystem: false,
      sortPosition: null,
    }, {
      id: '2',
      name: '成功池',
      color: '#666666',
      accountCount: 0,
      description: '',
      isSystem: false,
      sortPosition: null,
    }],
    outlookEmailAccounts: [{
      id: '11',
      email: 'demo@example.com',
      groupId: '1',
      groupName: '注册池',
      status: 'active',
      provider: 'outlook',
      accountType: 'outlook',
      aliases: [],
      aliasCount: 0,
      remark: '',
      forwardEnabled: false,
      lastRefreshAt: '',
      lastRefreshStatus: '',
      lastRefreshError: '',
      createdAt: '',
      updatedAt: '',
    }],
  };
  const persisted = [];
  const broadcasts = [];
  const emailStates = [];
  const helpers = api.createOutlookEmailProviderHelpers({
    addLog: async () => {},
    broadcastDataUpdate: (payload) => broadcasts.push(payload),
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === 'http://127.0.0.1:5000/login') {
        return createJsonResponse({ success: true, message: '登录成功' });
      }
      if (url === 'http://127.0.0.1:5000/api/csrf-token') {
        return createJsonResponse({ success: true, csrf_disabled: true });
      }
      if (url === 'http://127.0.0.1:5000/api/accounts/batch-update-group') {
        return createJsonResponse({ success: true, moved_count: 1 });
      }
      if (url === 'http://127.0.0.1:5000/api/groups') {
        return createJsonResponse({
          success: true,
          groups: [
            { id: 1, name: '注册池', account_count: 1 },
            { id: 2, name: '成功池', account_count: 1 },
          ],
        });
      }
      throw new Error(`unexpected request: ${url}`);
    },
    getState: async () => state,
    pickVerificationMessageWithTimeFallback: () => ({ match: null }),
    setEmailState: async (value) => {
      emailStates.push(value);
      state = { ...state, email: value };
    },
    setPersistentSettings: async (payload) => {
      persisted.push(payload);
      state = { ...state, ...payload };
    },
    setState: async (payload) => {
      state = { ...state, ...payload };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const account = await helpers.finalizeOutlookEmailAfterSuccessfulFlow(state);

  assert.deepStrictEqual(account, {
    id: '11',
    email: 'demo@example.com',
    groupId: '1',
    groupName: '注册池',
    status: 'active',
    provider: 'outlook',
    accountType: 'outlook',
    aliases: [],
    aliasCount: 0,
    remark: '',
    forwardEnabled: false,
    lastRefreshAt: '',
    lastRefreshStatus: '',
    lastRefreshError: '',
    createdAt: '',
    updatedAt: '',
  });
  assert.deepStrictEqual(calls.map((item) => item.url), [
    'http://127.0.0.1:5000/login',
    'http://127.0.0.1:5000/api/csrf-token',
    'http://127.0.0.1:5000/api/accounts/batch-update-group',
    'http://127.0.0.1:5000/api/groups',
  ]);
  assert.deepStrictEqual(JSON.parse(calls[2].options.body), {
    account_ids: [11],
    group_id: 2,
  });
  assert.deepStrictEqual(persisted, [{
    outlookEmailGroups: [{
      id: '1',
      name: '注册池',
      color: '#666666',
      accountCount: 1,
      description: '',
      isSystem: false,
      sortPosition: null,
    }, {
      id: '2',
      name: '成功池',
      color: '#666666',
      accountCount: 1,
      description: '',
      isSystem: false,
      sortPosition: null,
    }],
  }]);
  assert.deepStrictEqual(state.outlookEmailGroups, persisted[0].outlookEmailGroups);
  assert.deepStrictEqual(state.outlookEmailUsedAccountIds, ['11']);
  assert.equal(state.currentOutlookEmailAccountId, null);
  assert.deepStrictEqual(state.outlookEmailAccounts, []);
  assert.equal(state.email, null);
  assert.deepStrictEqual(emailStates, [null]);
  assert.ok(broadcasts.some((payload) => Array.isArray(payload.outlookEmailGroups)
    && payload.outlookEmailGroups[0]?.accountCount === 1
    && payload.outlookEmailGroups[1]?.accountCount === 1));
});

test('outlook email provider keeps success finalize non-fatal when group refresh fails', async () => {
  const source = fs.readFileSync('background/outlook-email-provider.js', 'utf8');
  const globalScope = {
    OutlookEmailUtils: require('../outlook-email-utils.js'),
  };
  const api = new Function('self', `${source}; return self.MultiPageOutlookEmailProvider;`)(globalScope);

  const calls = [];
  const logs = [];
  let state = {
    mailProvider: 'outlookemail-api',
    outlookEmailBaseUrl: 'http://127.0.0.1:5000/login',
    outlookEmailPassword: 'secret',
    outlookEmailSuccessGroupId: '2',
    currentOutlookEmailAccountId: '11',
    email: 'demo@example.com',
    outlookEmailUsedAccountIds: [],
    outlookEmailAccounts: [{
      id: '11',
      email: 'demo@example.com',
      groupId: '1',
      groupName: '注册池',
      status: 'active',
      provider: 'outlook',
      accountType: 'outlook',
      aliases: [],
      aliasCount: 0,
      remark: '',
      forwardEnabled: false,
      lastRefreshAt: '',
      lastRefreshStatus: '',
      lastRefreshError: '',
      createdAt: '',
      updatedAt: '',
    }],
  };
  const helpers = api.createOutlookEmailProviderHelpers({
    addLog: async (message, level) => {
      logs.push({ message, level });
    },
    broadcastDataUpdate: () => {},
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === 'http://127.0.0.1:5000/login') {
        return createJsonResponse({ success: true, message: '登录成功' });
      }
      if (url === 'http://127.0.0.1:5000/api/csrf-token') {
        return createJsonResponse({ success: true, csrf_disabled: true });
      }
      if (url === 'http://127.0.0.1:5000/api/accounts/batch-update-group') {
        return createJsonResponse({ success: true, moved_count: 1 });
      }
      if (url === 'http://127.0.0.1:5000/api/groups') {
        return createJsonResponse({ success: false, message: 'groups unavailable' }, 500);
      }
      throw new Error(`unexpected request: ${url}`);
    },
    getState: async () => state,
    pickVerificationMessageWithTimeFallback: () => ({ match: null }),
    setEmailState: async (value) => {
      state = { ...state, email: value };
    },
    setPersistentSettings: async () => {},
    setState: async (payload) => {
      state = { ...state, ...payload };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const account = await helpers.finalizeOutlookEmailAfterSuccessfulFlow(state);

  assert.equal(account?.id, '11');
  assert.deepStrictEqual(calls.map((item) => item.url), [
    'http://127.0.0.1:5000/login',
    'http://127.0.0.1:5000/api/csrf-token',
    'http://127.0.0.1:5000/api/accounts/batch-update-group',
    'http://127.0.0.1:5000/api/groups',
  ]);
  assert.ok(logs.some((entry) => entry.level === 'warn'
    && String(entry.message).includes('OutlookEmail 分组刷新失败')));
  assert.deepStrictEqual(state.outlookEmailUsedAccountIds, ['11']);
  assert.equal(state.currentOutlookEmailAccountId, null);
  assert.deepStrictEqual(state.outlookEmailAccounts, []);
  assert.equal(state.email, null);
});
