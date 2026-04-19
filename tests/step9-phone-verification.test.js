const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/steps/confirm-oauth.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundStep9;`)(globalScope);

function createChromeMock() {
  return {
    webNavigation: {
      onBeforeNavigate: {
        addListener() {},
        removeListener() {},
      },
      onCommitted: {
        addListener() {},
        removeListener() {},
      },
    },
    tabs: {
      onUpdated: {
        addListener() {},
        removeListener() {},
      },
      async update() {},
    },
  };
}

test('step 9 runs phone verification before OAuth continue and reuses continue flow on verification page', async () => {
  let webNavListener = null;
  let webNavCommittedListener = null;
  let tabUpdatedListener = null;
  let pendingReject = null;
  let ensurePhoneVerificationCallCount = 0;
  let effectCallCount = 0;
  const readyCalls = [];
  const triggerCalls = [];
  const completions = [];

  const executor = api.createStep9Executor({
    addLog: async () => {},
    chrome: createChromeMock(),
    cleanupStep8NavigationListeners: () => {
      webNavListener = null;
      webNavCommittedListener = null;
      tabUpdatedListener = null;
    },
    clickWithDebugger: async () => {},
    completeStepFromBackground: async (step, payload) => {
      completions.push({ step, payload });
    },
    ensureStep8SignupPageReady: async () => {},
    ensurePhoneVerificationIfNeeded: async () => {
      ensurePhoneVerificationCallCount += 1;
      return { handled: true };
    },
    getOAuthFlowStepTimeoutMs: async (timeoutMs) => timeoutMs,
    getStep8CallbackUrlFromNavigation: (details, signupTabId) => (
      details?.tabId === signupTabId && details?.frameId === 0 ? details.url : ''
    ),
    getStep8CallbackUrlFromTabUpdate: () => '',
    getStep8EffectLabel: (effect) => effect?.reason || 'unknown',
    getTabId: async () => 1,
    getWebNavCommittedListener: () => webNavCommittedListener,
    getWebNavListener: () => webNavListener,
    getStep8TabUpdatedListener: () => tabUpdatedListener,
    isTabAlive: async () => true,
    prepareStep8DebuggerClick: async () => ({ rect: { centerX: 1, centerY: 1 } }),
    reloadStep8ConsentPage: async () => {},
    reuseOrCreateTab: async () => 1,
    sleepWithStop: async () => {},
    STEP8_CLICK_RETRY_DELAY_MS: 0,
    STEP8_MAX_ROUNDS: 3,
    STEP8_READY_WAIT_TIMEOUT_MS: 3000,
    STEP8_STRATEGIES: [
      { mode: 'content', strategy: 'requestSubmit', label: 'requestSubmit' },
      { mode: 'content', strategy: 'nativeClick', label: 'nativeClick' },
    ],
    throwIfStep8SettledOrStopped: () => {},
    triggerStep8ContentStrategy: async (_tabId, strategy, options = {}) => {
      triggerCalls.push({ strategy, options });
      if (triggerCalls.length === 2 && typeof webNavListener === 'function') {
        webNavListener({
          tabId: 1,
          frameId: 0,
          url: 'http://localhost:1455/auth/callback?code=abc&state=xyz',
        });
      }
    },
    handlePhoneMaxUsageExceededFlow: async () => {},
    isPhoneMaxUsageExceededError: () => false,
    waitForStep8ClickEffect: async () => {
      effectCallCount += 1;
      return {
        progressed: false,
        reason: 'entered_consent_page',
        restartCurrentStep: true,
        url: 'https://auth.openai.com/authorize',
      };
    },
    waitForStep8Ready: async (_tabId, _timeoutMs, options = {}) => {
      readyCalls.push(options);
      return readyCalls.length === 1
        ? {
          verificationPage: true,
          consentReady: false,
          url: 'https://auth.openai.com/add-phone',
        }
        : {
          verificationPage: false,
          consentReady: true,
          url: 'https://auth.openai.com/authorize',
        };
    },
    setWebNavListener: (listener) => {
      webNavListener = listener;
    },
    setWebNavCommittedListener: (listener) => {
      webNavCommittedListener = listener;
    },
    setStep8PendingReject: (listener) => {
      pendingReject = listener;
    },
    setStep8TabUpdatedListener: (listener) => {
      tabUpdatedListener = listener;
    },
  });

  await executor.executeStep9({
    oauthUrl: 'https://auth.openai.com/authorize',
    heroSmsEnabled: true,
  });

  assert.equal(ensurePhoneVerificationCallCount, 1);
  assert.equal(effectCallCount, 1);
  assert.equal(readyCalls[0]?.allowVerificationPage, true);
  assert.equal(triggerCalls[0]?.options?.allowVerificationPage, true);
  assert.equal(completions.length, 1);
  assert.deepStrictEqual(completions[0], {
    step: 9,
    payload: {
      localhostUrl: 'http://localhost:1455/auth/callback?code=abc&state=xyz',
    },
  });
  assert.equal(pendingReject, null);
  assert.equal(webNavListener, null);
  assert.equal(webNavCommittedListener, null);
  assert.equal(tabUpdatedListener, null);
});

test('step 9 handles phone_max_usage_exceeded through dedicated recovery flow', async () => {
  let handledCount = 0;

  const executor = api.createStep9Executor({
    addLog: async () => {},
    chrome: createChromeMock(),
    cleanupStep8NavigationListeners: () => {},
    clickWithDebugger: async () => {},
    completeStepFromBackground: async () => {},
    ensureStep8SignupPageReady: async () => {},
    ensurePhoneVerificationIfNeeded: async () => {
      throw new Error('PHONE_MAX_USAGE_EXCEEDED::phone_max_usage_exceeded');
    },
    getOAuthFlowStepTimeoutMs: async (timeoutMs) => timeoutMs,
    getStep8CallbackUrlFromNavigation: () => '',
    getStep8CallbackUrlFromTabUpdate: () => '',
    getStep8EffectLabel: () => '',
    getTabId: async () => 1,
    getWebNavCommittedListener: () => null,
    getWebNavListener: () => null,
    getStep8TabUpdatedListener: () => null,
    isTabAlive: async () => true,
    prepareStep8DebuggerClick: async () => ({ rect: { centerX: 1, centerY: 1 } }),
    reloadStep8ConsentPage: async () => {},
    reuseOrCreateTab: async () => 1,
    sleepWithStop: async () => {},
    STEP8_CLICK_RETRY_DELAY_MS: 0,
    STEP8_MAX_ROUNDS: 1,
    STEP8_READY_WAIT_TIMEOUT_MS: 1000,
    STEP8_STRATEGIES: [
      { mode: 'content', strategy: 'requestSubmit', label: 'requestSubmit' },
    ],
    throwIfStep8SettledOrStopped: () => {},
    triggerStep8ContentStrategy: async () => {},
    handlePhoneMaxUsageExceededFlow: async () => {
      handledCount += 1;
    },
    isPhoneMaxUsageExceededError: (error) => /PHONE_MAX_USAGE_EXCEEDED::/.test(error?.message || String(error || '')),
    waitForStep8ClickEffect: async () => ({ progressed: false, reason: 'no_effect' }),
    waitForStep8Ready: async () => ({ consentReady: true, url: 'https://auth.openai.com/authorize' }),
    setWebNavListener: () => {},
    setWebNavCommittedListener: () => {},
    setStep8PendingReject: () => {},
    setStep8TabUpdatedListener: () => {},
  });

  await assert.rejects(
    () => executor.executeStep9({
      oauthUrl: 'https://auth.openai.com/authorize',
      heroSmsEnabled: true,
    }),
    /PHONE_MAX_USAGE_EXCEEDED::phone_max_usage_exceeded/
  );

  assert.equal(handledCount, 1);
});

test('step 9 surfaces hero sms first code timeout for outer retry flow', async () => {
  const logs = [];
  let phoneMaxHandled = 0;

  const executor = api.createStep9Executor({
    addLog: async (message, level = 'info') => {
      logs.push({ message, level });
    },
    chrome: createChromeMock(),
    cleanupStep8NavigationListeners: () => {},
    clickWithDebugger: async () => {},
    completeStepFromBackground: async () => {},
    ensureStep8SignupPageReady: async () => {},
    ensurePhoneVerificationIfNeeded: async () => {
      throw new Error('HERO_SMS_FIRST_CODE_TIMEOUT::no_first_sms_in_125s');
    },
    getOAuthFlowStepTimeoutMs: async (timeoutMs) => timeoutMs,
    getStep8CallbackUrlFromNavigation: () => '',
    getStep8CallbackUrlFromTabUpdate: () => '',
    getStep8EffectLabel: () => '',
    getTabId: async () => 1,
    getWebNavCommittedListener: () => null,
    getWebNavListener: () => null,
    getStep8TabUpdatedListener: () => null,
    isTabAlive: async () => true,
    prepareStep8DebuggerClick: async () => ({ rect: { centerX: 1, centerY: 1 } }),
    reloadStep8ConsentPage: async () => {},
    reuseOrCreateTab: async () => 1,
    sleepWithStop: async () => {},
    STEP8_CLICK_RETRY_DELAY_MS: 0,
    STEP8_MAX_ROUNDS: 1,
    STEP8_READY_WAIT_TIMEOUT_MS: 1000,
    STEP8_STRATEGIES: [
      { mode: 'content', strategy: 'requestSubmit', label: 'requestSubmit' },
    ],
    throwIfStep8SettledOrStopped: () => {},
    triggerStep8ContentStrategy: async () => {},
    handlePhoneMaxUsageExceededFlow: async () => {
      phoneMaxHandled += 1;
    },
    isHeroSmsFirstCodeTimeoutError: (error) => /HERO_SMS_FIRST_CODE_TIMEOUT::/.test(error?.message || String(error || '')),
    isPhoneMaxUsageExceededError: () => false,
    waitForStep8ClickEffect: async () => ({ progressed: false, reason: 'no_effect' }),
    waitForStep8Ready: async () => ({ consentReady: true, url: 'https://auth.openai.com/authorize' }),
    setWebNavListener: () => {},
    setWebNavCommittedListener: () => {},
    setStep8PendingReject: () => {},
    setStep8TabUpdatedListener: () => {},
  });

  await assert.rejects(
    () => executor.executeStep9({
      oauthUrl: 'https://auth.openai.com/authorize',
      heroSmsEnabled: true,
    }),
    /HERO_SMS_FIRST_CODE_TIMEOUT::no_first_sms_in_125s/
  );

  assert.equal(phoneMaxHandled, 0);
  assert.ok(logs.some(({ message }) => /125 秒内未收到任何验证码/.test(message)));
});
