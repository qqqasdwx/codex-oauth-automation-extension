const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const moduleSource = fs.readFileSync('background/phone-verification.js', 'utf8');
const backgroundSource = fs.readFileSync('background.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${moduleSource}; return self.MultiPageBackgroundPhoneVerification;`)(globalScope);

test('background imports hero sms utils and phone verification module', () => {
  assert.match(backgroundSource, /hero-sms-utils\.js/);
  assert.match(backgroundSource, /background\/phone-verification\.js/);
});

test('phone verification module exposes a factory', () => {
  assert.equal(typeof api?.createPhoneVerificationHelpers, 'function');
});

test('phone verification helper no-ops when current page is not add-phone', async () => {
  const executeResults = [
    { url: 'https://auth.openai.com/authorize', addPhonePage: false },
  ];

  const helpers = api.createPhoneVerificationHelpers({
    addLog: async () => {},
    broadcastDataUpdate: () => {},
    chrome: {
      scripting: {
        async executeScript() {
          return [{ result: executeResults.shift() }];
        },
      },
    },
    clearLuckmailRuntimeState: async () => {},
    getCurrentLuckmailPurchase: () => null,
    getState: async () => ({}),
    heroFindOrCreateSmsActivation: async () => {
      throw new Error('should not request sms activation');
    },
    heroFinishSmsActivation: async () => {},
    heroPollSmsVerificationCode: async () => {
      throw new Error('should not poll sms code');
    },
    isHotmailProvider: () => false,
    isLuckmailProvider: () => false,
    patchHotmailAccount: async () => {},
    setLuckmailPurchaseUsedState: async () => {},
    setState: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const result = await helpers.ensurePhoneVerificationIfNeeded({
    heroSmsEnabled: true,
    heroSmsApiKey: 'demo-key',
    heroSmsCountry: '52',
  }, 101);

  assert.deepStrictEqual(result, {
    handled: false,
    reason: 'not_needed',
    pageState: { url: 'https://auth.openai.com/authorize', addPhonePage: false },
  });
});

test('phone verification helper completes add-phone flow with hero sms activation', async () => {
  const logs = [];
  const stateUpdates = [];
  const broadcasts = [];
  let runtimeState = {
    heroSmsEnabled: true,
    heroSmsApiKey: 'demo-key',
    heroSmsCountry: '52',
    currentHeroSmsActivationId: null,
    currentHeroSmsPhoneNumber: null,
  };

  const executeResults = [
    {
      url: 'https://auth.openai.com/add-phone',
      addPhonePage: true,
      phoneInputVisible: true,
      verificationInputVisible: false,
      phoneMaxUsageExceeded: false,
    },
    { ok: true, clicked: true },
    {
      url: 'https://auth.openai.com/add-phone',
      addPhonePage: true,
      phoneInputVisible: false,
      verificationInputVisible: true,
      phoneMaxUsageExceeded: false,
    },
    { ok: true, clicked: true },
    {
      url: 'https://auth.openai.com/authorize',
      addPhonePage: false,
      phoneInputVisible: false,
      verificationInputVisible: false,
      phoneMaxUsageExceeded: false,
    },
  ];

  const helpers = api.createPhoneVerificationHelpers({
    addLog: async (message, level = 'info') => {
      logs.push({ message, level });
    },
    broadcastDataUpdate: (payload) => {
      broadcasts.push(payload);
    },
    chrome: {
      scripting: {
        async executeScript() {
          return [{ result: executeResults.shift() }];
        },
      },
    },
    clearLuckmailRuntimeState: async () => {},
    getCurrentLuckmailPurchase: () => null,
    getState: async () => ({ ...runtimeState }),
    heroFindOrCreateSmsActivation: async () => ({
      activationId: 'act-1',
      phoneNumber: '8520001111',
    }),
    heroFinishSmsActivation: async () => {},
    heroPollSmsVerificationCode: async (_apiKey, activationId, onLog, step) => {
      await onLog(step, `activation=${activationId}`, 'info');
      return '654321';
    },
    isHotmailProvider: () => false,
    isLuckmailProvider: () => false,
    patchHotmailAccount: async () => {},
    setLuckmailPurchaseUsedState: async () => {},
    setState: async (updates) => {
      runtimeState = { ...runtimeState, ...updates };
      stateUpdates.push(updates);
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const result = await helpers.ensurePhoneVerificationIfNeeded(runtimeState, 202, {
    codeStageTimeoutMs: 5000,
  });

  assert.equal(result.handled, true);
  assert.equal(result.activationId, 'act-1');
  assert.equal(result.phoneNumber, '8520001111');
  assert.ok(stateUpdates.some((payload) => payload.currentHeroSmsActivationId === 'act-1'));
  assert.ok(stateUpdates.some((payload) => payload.currentHeroSmsPhoneNumber === '8520001111'));
  assert.ok(broadcasts.some((payload) => payload.currentHeroSmsActivationId === 'act-1'));
  assert.ok(logs.some(({ message }) => /已获取手机号/.test(message)));
  assert.ok(logs.some(({ message }) => /已提交短信验证码/.test(message)));
});

test('phone verification cleanup clears runtime state without finishing activation by default', async () => {
  const stateUpdates = [];
  const broadcasts = [];
  let finishCalls = 0;

  const helpers = api.createPhoneVerificationHelpers({
    addLog: async () => {},
    broadcastDataUpdate: (payload) => {
      broadcasts.push(payload);
    },
    chrome: {
      scripting: {
        async executeScript() {
          return [{ result: null }];
        },
      },
    },
    clearLuckmailRuntimeState: async () => {},
    getCurrentLuckmailPurchase: () => null,
    getState: async () => ({
      heroSmsApiKey: 'demo-key',
      currentHeroSmsActivationId: 'act-keep',
      currentHeroSmsPhoneNumber: '8520001111',
    }),
    heroFindOrCreateSmsActivation: async () => ({}),
    heroFinishSmsActivation: async () => {
      finishCalls += 1;
    },
    heroPollSmsVerificationCode: async () => '654321',
    isHotmailProvider: () => false,
    isLuckmailProvider: () => false,
    patchHotmailAccount: async () => {},
    setLuckmailPurchaseUsedState: async () => {},
    setState: async (updates) => {
      stateUpdates.push(updates);
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const result = await helpers.cleanupHeroSmsActivation({
    state: {
      heroSmsApiKey: 'demo-key',
      currentHeroSmsActivationId: 'act-keep',
      currentHeroSmsPhoneNumber: '8520001111',
    },
  });

  assert.deepStrictEqual(result, {
    finished: false,
    cleared: true,
  });
  assert.equal(finishCalls, 0);
  assert.ok(stateUpdates.some((payload) => payload.currentHeroSmsActivationId === null));
  assert.ok(stateUpdates.some((payload) => payload.currentHeroSmsPhoneNumber === null));
  assert.ok(broadcasts.some((payload) => payload.currentHeroSmsActivationId === null));
});

test('phone verification helper handles phone_max_usage_exceeded by finishing activation and clearing runtime state', async () => {
  const logs = [];
  const stateUpdates = [];
  let finishedActivationId = null;

  const helpers = api.createPhoneVerificationHelpers({
    addLog: async (message, level = 'info') => {
      logs.push({ message, level });
    },
    broadcastDataUpdate: () => {},
    chrome: {
      scripting: {
        async executeScript() {
          return [{ result: null }];
        },
      },
    },
    clearLuckmailRuntimeState: async () => {},
    getCurrentLuckmailPurchase: () => null,
    getState: async () => ({
      heroSmsApiKey: 'demo-key',
      currentHeroSmsActivationId: 'act-limit',
      currentHeroSmsPhoneNumber: '8520001111',
      currentHotmailAccountId: null,
    }),
    heroFindOrCreateSmsActivation: async () => ({}),
    heroFinishSmsActivation: async (_apiKey, activationId) => {
      finishedActivationId = activationId;
    },
    heroPollSmsVerificationCode: async () => '654321',
    isHotmailProvider: () => false,
    isLuckmailProvider: () => false,
    patchHotmailAccount: async () => {},
    setLuckmailPurchaseUsedState: async () => {},
    setState: async (updates) => {
      stateUpdates.push(updates);
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  await helpers.handlePhoneMaxUsageExceededFlow({
    heroSmsApiKey: 'demo-key',
    currentHeroSmsActivationId: 'act-limit',
    currentHeroSmsPhoneNumber: '8520001111',
    currentHotmailAccountId: null,
  });

  assert.equal(finishedActivationId, 'act-limit');
  assert.ok(stateUpdates.some((payload) => payload.currentHeroSmsActivationId === null));
  assert.ok(logs.some(({ message }) => /phone_max_usage_exceeded/.test(message)));
  assert.ok(logs.some(({ message }) => /已调用 Hero-SMS 完成激活/.test(message)));
});

test('phone verification helper clears runtime state when hero sms first code timeout happens', async () => {
  const stateUpdates = [];
  const broadcasts = [];
  let finishCalls = 0;

  const executeResults = [
    {
      url: 'https://auth.openai.com/add-phone',
      addPhonePage: true,
      phoneInputVisible: false,
      verificationInputVisible: true,
      phoneMaxUsageExceeded: false,
    },
  ];

  const helpers = api.createPhoneVerificationHelpers({
    addLog: async () => {},
    broadcastDataUpdate: (payload) => {
      broadcasts.push(payload);
    },
    chrome: {
      scripting: {
        async executeScript() {
          return [{ result: executeResults.shift() }];
        },
      },
    },
    clearLuckmailRuntimeState: async () => {},
    getCurrentLuckmailPurchase: () => null,
    getState: async () => ({
      heroSmsEnabled: true,
      heroSmsApiKey: 'demo-key',
      heroSmsCountry: '852',
      currentHeroSmsActivationId: 'act-timeout',
      currentHeroSmsPhoneNumber: '8520009999',
    }),
    heroFindOrCreateSmsActivation: async () => ({
      activationId: 'should-not-run',
      phoneNumber: '8520000000',
    }),
    heroFinishSmsActivation: async () => {
      finishCalls += 1;
    },
    heroPollSmsVerificationCode: async () => {
      throw new Error('HERO_SMS_FIRST_CODE_TIMEOUT::no_first_sms_in_125s');
    },
    isHeroSmsFirstCodeTimeoutError: (error) => /HERO_SMS_FIRST_CODE_TIMEOUT::/.test(error?.message || String(error || '')),
    isHotmailProvider: () => false,
    isLuckmailProvider: () => false,
    patchHotmailAccount: async () => {},
    setLuckmailPurchaseUsedState: async () => {},
    setState: async (updates) => {
      stateUpdates.push(updates);
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  await assert.rejects(
    helpers.ensurePhoneVerificationIfNeeded({
      heroSmsEnabled: true,
      heroSmsApiKey: 'demo-key',
      heroSmsCountry: '852',
      currentHeroSmsActivationId: 'act-timeout',
      currentHeroSmsPhoneNumber: '8520009999',
    }, 303),
    /HERO_SMS_FIRST_CODE_TIMEOUT::/
  );

  assert.equal(finishCalls, 0);
  assert.ok(stateUpdates.some((payload) => payload.currentHeroSmsActivationId === null));
  assert.ok(stateUpdates.some((payload) => payload.currentHeroSmsPhoneNumber === null));
  assert.ok(broadcasts.some((payload) => payload.currentHeroSmsActivationId === null));
});
