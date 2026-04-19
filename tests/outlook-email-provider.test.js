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
