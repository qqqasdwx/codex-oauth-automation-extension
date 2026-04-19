const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports message router module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/message-router\.js/);
});

test('message router module exposes a factory', () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  assert.equal(typeof api?.createMessageRouter, 'function');
});

test('message router step 10 only clears Hero-SMS runtime state and does not finish activation on success', async () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  const cleanupCalls = [];

  const router = api.createMessageRouter({
    addLog: async () => {},
    appendAccountRunRecord: async () => null,
    broadcastDataUpdate: () => {},
    buildLocalhostCleanupPrefix: () => '',
    cleanupHeroSmsActivation: async (payload) => {
      cleanupCalls.push(payload);
    },
    clearLuckmailRuntimeState: async () => {},
    closeLocalhostCallbackTabs: async () => {},
    closeTabsByUrlPrefix: async () => {},
    finalizeIcloudAliasAfterSuccessfulFlow: async () => {},
    getCurrentLuckmailPurchase: () => null,
    getState: async () => ({
      heroSmsApiKey: 'demo-key',
      currentHeroSmsActivationId: 'act-keep',
      currentHeroSmsPhoneNumber: '8520001111',
      currentHotmailAccountId: null,
    }),
    isAutoRunLockedState: () => false,
    isHotmailProvider: () => false,
    isLocalhostOAuthCallbackUrl: () => true,
    isLuckmailProvider: () => false,
    patchHotmailAccount: async () => {},
    setLuckmailPurchaseUsedState: async () => {},
    setState: async () => {},
  });

  await router.handleStepData(10, {
    localhostUrl: 'http://localhost:1455/auth/callback?code=abc&state=xyz',
  });

  assert.equal(cleanupCalls.length, 1);
  assert.equal(cleanupCalls[0].finish, undefined);
  assert.equal(cleanupCalls[0].state.currentHeroSmsActivationId, 'act-keep');
});

test('message router routes FETCH_OUTLOOKEMAIL_GROUPS to provider helper', async () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  let fetchCalls = 0;
  const router = api.createMessageRouter({
    addLog: async () => {},
    buildPersistentSettingsPayload: () => ({}),
    buildLuckmailSessionSettingsPayload: () => ({}),
    fetchOutlookEmailGroups: async () => {
      fetchCalls += 1;
      return [{ id: '1', name: '注册池' }];
    },
    getState: async () => ({ stepStatuses: {} }),
    setPersistentSettings: async () => {},
    setState: async () => {},
  });

  const result = await router.handleMessage({
    type: 'FETCH_OUTLOOKEMAIL_GROUPS',
    source: 'sidepanel',
    payload: {},
  }, {});

  assert.equal(fetchCalls, 1);
  assert.deepStrictEqual(result, {
    ok: true,
    groups: [{ id: '1', name: '注册池' }],
  });
});
