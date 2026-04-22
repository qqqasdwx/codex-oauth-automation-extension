const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/verification-flow.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundVerificationFlow;`)(globalScope);

test('verification flow extends 2925 polling window', () => {
  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async () => ({}),
    sendToMailContentScriptResilient: async () => ({}),
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const step4Payload = helpers.getVerificationPollPayload(4, { email: 'user@example.com', mailProvider: '2925' });
  const step8Payload = helpers.getVerificationPollPayload(8, { email: 'user@example.com', mailProvider: '2925' });

  assert.equal(step4Payload.filterAfterTimestamp, 0);
  assert.equal(step4Payload.maxAttempts, 15);
  assert.equal(step4Payload.intervalMs, 15000);
  assert.equal(step8Payload.filterAfterTimestamp, 0);
  assert.equal(step8Payload.maxAttempts, 15);
  assert.equal(step8Payload.intervalMs, 15000);
});

test('verification flow only enables 2925 target email matching in receive mode', () => {
  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async () => ({}),
    sendToMailContentScriptResilient: async () => ({}),
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const providePayload = helpers.getVerificationPollPayload(4, {
    email: 'user@example.com',
    mailProvider: '2925',
    mail2925Mode: 'provide',
  });
  const receivePayload = helpers.getVerificationPollPayload(4, {
    email: 'user@example.com',
    mailProvider: '2925',
    mail2925Mode: 'receive',
  });

  assert.equal(providePayload.mail2925MatchTargetEmail, false);
  assert.equal(receivePayload.mail2925MatchTargetEmail, true);
});

test('verification flow delegates outlookemail-api polling to OutlookEmail provider helper', async () => {
  const events = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 123,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    pollOutlookEmailVerificationCode: async (step, state, payload) => {
      events.push({ step, state, payload });
      return {
        code: '112233',
        emailTimestamp: 456,
      };
    },
    sendToContentScript: async () => ({}),
    sendToMailContentScriptResilient: async () => {
      throw new Error('should not call mail content script for OutlookEmail provider');
    },
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const result = await helpers.pollFreshVerificationCode(
    4,
    { email: 'pool@example.com', mailProvider: 'outlookemail-api' },
    { provider: 'outlookemail-api', label: 'OutlookEmail（邮箱池）' },
    { intervalMs: 2000, maxAttempts: 4 }
  );

  assert.equal(result.code, '112233');
  assert.equal(events.length, 1);
  assert.equal(events[0].step, 4);
  assert.equal(events[0].state.mailProvider, 'outlookemail-api');
  assert.equal(events[0].payload.intervalMs, 2000);
});

test('verification flow runs beforeSubmit hook before filling the code', async () => {
  const events = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (_step, payload) => {
      events.push(['complete', payload.code]);
    },
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        events.push(['submit', message.payload.code]);
        return {};
      }
      return {};
    },
    sendToMailContentScriptResilient: async () => ({
      code: '654321',
      emailTimestamp: 123,
    }),
    setState: async (payload) => {
      events.push(['state', payload.lastLoginCode || payload.lastSignupCode]);
    },
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    7,
    { email: 'user@example.com', lastLoginCode: null },
    { provider: 'qq', label: 'QQ 邮箱' },
    {
      beforeSubmit: async (result) => {
        events.push(['beforeSubmit', result.code]);
      },
    }
  );

  assert.deepStrictEqual(events, [
    ['beforeSubmit', '654321'],
    ['submit', '654321'],
    ['state', '654321'],
    ['complete', '654321'],
  ]);
});

test('verification flow skips 2925 mailbox preclear when using a fixed login mail window and still clears after success', async () => {
  const mailMessages = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        return {};
      }
      return {};
    },
    sendToMailContentScriptResilient: async (_mail, message) => {
      mailMessages.push(message.type);
      if (message.type === 'POLL_EMAIL') {
        return { code: '654321', emailTimestamp: 123 };
      }
      return { ok: true };
    },
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    8,
    {
      email: 'user@example.com',
      mailProvider: '2925',
      lastLoginCode: null,
    },
    { provider: '2925', label: '2925 邮箱' },
    { filterAfterTimestamp: 123456 }
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepStrictEqual(mailMessages, ['POLL_EMAIL', 'DELETE_ALL_EMAILS']);
});

test('verification flow skips 2925 mailbox preclear when using a fixed signup mail window and still clears after success', async () => {
  const mailMessages = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        return {};
      }
      if (message.type === 'RESEND_VERIFICATION_CODE') {
        return {};
      }
      return {};
    },
    sendToMailContentScriptResilient: async (_mail, message) => {
      mailMessages.push(message.type);
      if (message.type === 'POLL_EMAIL') {
        return { code: '654321', emailTimestamp: 123 };
      }
      return { ok: true, deleted: true };
    },
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    4,
    {
      email: 'user@example.com',
      mailProvider: '2925',
      lastSignupCode: null,
    },
    { provider: '2925', label: '2925 邮箱' },
    {
      filterAfterTimestamp: 123456,
      requestFreshCodeFirst: false,
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepStrictEqual(mailMessages, ['POLL_EMAIL', 'DELETE_ALL_EMAILS']);
});

test('verification flow waits for deferred verification submit outcome after fill command is accepted', async () => {
  const events = [];
  let outcomeChecks = 0;

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (_step, payload) => {
      events.push(['complete', payload.code]);
    },
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        events.push(['submit', message.payload.code]);
        return { accepted: true };
      }
      throw new Error(`unexpected direct message: ${message.type}`);
    },
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type !== 'GET_VERIFICATION_SUBMIT_OUTCOME') {
        throw new Error(`unexpected resilient message: ${message.type}`);
      }
      outcomeChecks += 1;
      return outcomeChecks < 2
        ? { pending: true, verificationVisible: true, phase: 'submitted' }
        : { success: true };
    },
    sendToMailContentScriptResilient: async () => ({
      code: '654321',
      emailTimestamp: 123,
    }),
    setState: async (payload) => {
      events.push(['state', payload.lastSignupCode || payload.lastLoginCode]);
    },
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    4,
    { email: 'user@example.com', lastSignupCode: null },
    { provider: 'qq', label: 'QQ 邮箱' },
    {}
  );

  assert.equal(outcomeChecks, 2);
  assert.deepStrictEqual(events, [
    ['submit', '654321'],
    ['state', '654321'],
    ['complete', '654321'],
  ]);
});

test('verification flow carries step 4 existing-account branch into completion payload', async () => {
  const events = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (_step, payload) => {
      events.push(['complete', payload]);
    },
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        events.push(['submit', message.payload.code]);
        return { accepted: true };
      }
      throw new Error(`unexpected direct message: ${message.type}`);
    },
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type !== 'GET_VERIFICATION_SUBMIT_OUTCOME') {
        throw new Error(`unexpected resilient message: ${message.type}`);
      }
      return {
        success: true,
        directProceedToStep6: true,
        branch: 'existing_account_login',
        landingState: 'password_page',
        url: 'https://auth.openai.com/log-in',
      };
    },
    sendToMailContentScriptResilient: async () => ({
      code: '654321',
      emailTimestamp: 123,
    }),
    setState: async (payload) => {
      events.push(['state', payload.lastSignupCode || payload.lastLoginCode]);
    },
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const result = await helpers.resolveVerificationStep(
    4,
    { email: 'user@example.com', lastSignupCode: null },
    { provider: 'qq', label: 'QQ 邮箱' },
    {}
  );

  assert.deepStrictEqual(events, [
    ['submit', '654321'],
    ['state', '654321'],
    ['complete', {
      emailTimestamp: 123,
      code: '654321',
      branch: 'existing_account_login',
      directProceedToStep6: true,
      landingState: 'password_page',
      url: 'https://auth.openai.com/log-in',
    }],
  ]);
  assert.deepStrictEqual(result, {
    branch: 'existing_account_login',
    code: '654321',
    emailTimestamp: 123,
    directProceedToStep6: true,
    landingState: 'password_page',
    url: 'https://auth.openai.com/log-in',
  });
});

test('verification flow short-circuits step 4 outcome polling when tab url already entered existing-account branch', async () => {
  const events = [];
  let outcomeProbeCount = 0;

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
        get: async () => ({
          id: 1,
          url: 'https://chatgpt.com/',
          status: 'complete',
        }),
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (_step, payload) => {
      events.push(['complete', payload]);
    },
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        events.push(['submit', message.payload.code]);
        return { accepted: true };
      }
      throw new Error(`unexpected direct message: ${message.type}`);
    },
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type !== 'GET_VERIFICATION_SUBMIT_OUTCOME') {
        throw new Error(`unexpected resilient message: ${message.type}`);
      }
      outcomeProbeCount += 1;
      throw new Error('Receiving end does not exist.');
    },
    sendToMailContentScriptResilient: async () => ({
      code: '654321',
      emailTimestamp: 123,
    }),
    setState: async (payload) => {
      events.push(['state', payload.lastSignupCode || payload.lastLoginCode]);
    },
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const result = await helpers.resolveVerificationStep(
    4,
    { email: 'user@example.com', lastSignupCode: null },
    { provider: 'qq', label: 'QQ 邮箱' },
    { step4DirectProceedStableWindowMs: 0 }
  );

  assert.equal(outcomeProbeCount, 1);
  assert.deepStrictEqual(events, [
    ['submit', '654321'],
    ['state', '654321'],
    ['complete', {
      emailTimestamp: 123,
      code: '654321',
      branch: 'existing_account_login',
      directProceedToStep6: true,
      landingState: 'chatgpt_entry_page',
      url: 'https://chatgpt.com/',
    }],
  ]);
  assert.deepStrictEqual(result, {
    branch: 'existing_account_login',
    code: '654321',
    emailTimestamp: 123,
    directProceedToStep6: true,
    landingState: 'chatgpt_entry_page',
    url: 'https://chatgpt.com/',
  });
});

test('verification flow does not short-circuit step 4 when new-account flow lands on about-you page', async () => {
  const events = [];
  let outcomeChecks = 0;

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
        get: async () => ({
          id: 1,
          url: 'https://auth.openai.com/about-you',
          status: 'complete',
        }),
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (_step, payload) => {
      events.push(['complete', payload]);
    },
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        events.push(['submit', message.payload.code]);
        return { accepted: true };
      }
      throw new Error(`unexpected direct message: ${message.type}`);
    },
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type !== 'GET_VERIFICATION_SUBMIT_OUTCOME') {
        throw new Error(`unexpected resilient message: ${message.type}`);
      }
      outcomeChecks += 1;
      return { success: true, url: 'https://auth.openai.com/about-you' };
    },
    sendToMailContentScriptResilient: async () => ({
      code: '654321',
      emailTimestamp: 123,
    }),
    setState: async (payload) => {
      events.push(['state', payload.lastSignupCode || payload.lastLoginCode]);
    },
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const result = await helpers.resolveVerificationStep(
    4,
    { email: 'user@example.com', lastSignupCode: null },
    { provider: 'qq', label: 'QQ 邮箱' },
    {}
  );

  assert.equal(outcomeChecks, 1);
  assert.deepStrictEqual(events, [
    ['submit', '654321'],
    ['state', '654321'],
    ['complete', {
      emailTimestamp: 123,
      code: '654321',
      branch: 'normal',
      directProceedToStep6: false,
      landingState: '',
      url: 'https://auth.openai.com/about-you',
    }],
  ]);
  assert.deepStrictEqual(result, {
    branch: 'normal',
    code: '654321',
    emailTimestamp: 123,
    directProceedToStep6: false,
    landingState: '',
    url: 'https://auth.openai.com/about-you',
  });
});

test('verification flow ignores transient chatgpt home url and waits for the final new-account page', async () => {
  const events = [];
  let tabReadCount = 0;
  let outcomeChecks = 0;

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
        get: async () => {
          tabReadCount += 1;
          if (tabReadCount === 1) {
            return {
              id: 1,
              url: 'https://chatgpt.com/',
              status: 'complete',
            };
          }
          return {
            id: 1,
            url: 'https://auth.openai.com/about-you',
            status: 'complete',
          };
        },
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (_step, payload) => {
      events.push(['complete', payload]);
    },
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        events.push(['submit', message.payload.code]);
        return { accepted: true };
      }
      throw new Error(`unexpected direct message: ${message.type}`);
    },
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type !== 'GET_VERIFICATION_SUBMIT_OUTCOME') {
        throw new Error(`unexpected resilient message: ${message.type}`);
      }
      outcomeChecks += 1;
      if (outcomeChecks === 1) {
        throw new Error('Receiving end does not exist.');
      }
      return { success: true, url: 'https://auth.openai.com/about-you' };
    },
    sendToMailContentScriptResilient: async () => ({
      code: '654321',
      emailTimestamp: 123,
    }),
    setState: async (payload) => {
      events.push(['state', payload.lastSignupCode || payload.lastLoginCode]);
    },
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const result = await helpers.resolveVerificationStep(
    4,
    { email: 'user@example.com', lastSignupCode: null },
    { provider: 'qq', label: 'QQ 邮箱' },
    { step4DirectProceedStableWindowMs: 500 }
  );

  assert.equal(outcomeChecks, 2);
  assert.deepStrictEqual(events, [
    ['submit', '654321'],
    ['state', '654321'],
    ['complete', {
      emailTimestamp: 123,
      code: '654321',
      branch: 'normal',
      directProceedToStep6: false,
      landingState: '',
      url: 'https://auth.openai.com/about-you',
    }],
  ]);
  assert.deepStrictEqual(result, {
    branch: 'normal',
    code: '654321',
    emailTimestamp: 123,
    directProceedToStep6: false,
    landingState: '',
    url: 'https://auth.openai.com/about-you',
  });
});

test('verification flow preclears 2925 mailbox before polling and clears again after successful submission', async () => {
  const mailMessages = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        return {};
      }
      return {};
    },
    sendToMailContentScriptResilient: async (_mail, message) => {
      mailMessages.push(message.type);
      if (message.type === 'POLL_EMAIL') {
        return { code: '654321', emailTimestamp: 123 };
      }
      return { ok: true };
    },
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    8,
    {
      email: 'user@example.com',
      mailProvider: '2925',
      lastLoginCode: null,
    },
    { provider: '2925', label: '2925 邮箱' },
    {}
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepStrictEqual(mailMessages, ['DELETE_ALL_EMAILS', 'POLL_EMAIL', 'DELETE_ALL_EMAILS']);
});

test('verification flow treats add-phone after login code submit as fatal instead of completing step 8', async () => {
  const events = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (_step, payload) => {
      events.push(['complete', payload.code]);
    },
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        events.push(['submit', message.payload.code]);
        return {
          addPhonePage: true,
          url: 'https://auth.openai.com/add-phone',
        };
      }
      return {};
    },
    sendToMailContentScriptResilient: async () => ({
      code: '654321',
      emailTimestamp: 123,
    }),
    setState: async (payload) => {
      events.push(['state', payload.lastLoginCode || payload.lastSignupCode]);
    },
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await assert.rejects(
    () => helpers.resolveVerificationStep(
      8,
      { email: 'user@example.com', lastLoginCode: null },
      { provider: 'qq', label: 'QQ 邮箱' },
      {}
    ),
    /验证码提交后页面进入手机号页面/
  );

  assert.deepStrictEqual(events, [
    ['submit', '654321'],
  ]);
});

test('verification flow allows step 8 to branch into phone verification when explicitly enabled', async () => {
  const events = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async (_step, payload) => {
      events.push(['complete', payload.branch, payload.addPhonePage, payload.code]);
    },
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        events.push(['submit', message.payload.code]);
        return {
          addPhonePage: true,
          url: 'https://auth.openai.com/add-phone',
        };
      }
      return {};
    },
    sendToMailContentScriptResilient: async () => ({
      code: '654321',
      emailTimestamp: 123,
    }),
    setState: async (payload) => {
      events.push(['state', payload.lastLoginCode || payload.lastSignupCode]);
    },
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  const result = await helpers.resolveVerificationStep(
    8,
    { email: 'user@example.com', lastLoginCode: null },
    { provider: 'qq', label: 'QQ 邮箱' },
    { allowAddPhoneSuccess: true }
  );

  assert.deepStrictEqual(result, {
    branch: 'phone_verification',
    addPhonePage: true,
    url: 'https://auth.openai.com/add-phone',
    code: '654321',
    emailTimestamp: 123,
  });
  assert.deepStrictEqual(events, [
    ['submit', '654321'],
    ['state', '654321'],
    ['complete', 'phone_verification', true, '654321'],
  ]);
});

test('verification flow caps mail polling timeout to the remaining oauth budget', async () => {
  const mailPollCalls = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        return {};
      }
      return {};
    },
    sendToMailContentScriptResilient: async (_mail, message, options) => {
      mailPollCalls.push({
        payload: message.payload,
        options,
      });
      return { code: '654321', emailTimestamp: 123 };
    },
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    8,
    {
      email: 'user@example.com',
      lastLoginCode: null,
    },
    { provider: 'qq', label: 'QQ 邮箱' },
    {
      getRemainingTimeMs: async () => 5000,
      resendIntervalMs: 0,
    }
  );

  assert.ok(mailPollCalls.length >= 1);
  assert.equal(mailPollCalls[0].options.timeoutMs, 5000);
  assert.equal(mailPollCalls[0].options.responseTimeoutMs, 5000);
  assert.equal(mailPollCalls[0].payload.maxAttempts, 2);
});

test('verification flow keeps Hotmail request timestamp filtering on the first poll', async () => {
  const pollPayloads = [];

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 87654,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async (_step, _state, payload) => {
      pollPayloads.push(payload);
      return { code: '654321', emailTimestamp: 123 };
    },
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        return {};
      }
      return {};
    },
    sendToMailContentScriptResilient: async () => ({}),
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    7,
    {
      email: 'user@example.com',
      loginVerificationRequestedAt: 100000,
      lastLoginCode: null,
    },
    { provider: 'hotmail-api', label: 'Hotmail' },
    {}
  );

  assert.equal(pollPayloads.length, 1);
  assert.equal(pollPayloads[0].filterAfterTimestamp, 87654);
});

test('verification flow keeps fixed filter timestamp after step 4 resend', async () => {
  const pollPayloads = [];

  let submitCount = 0;

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: (_step, state) => Math.max(0, Number(state.signupVerificationRequestedAt || 0) - 15000),
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async (_step, _state, payload) => {
      pollPayloads.push(payload);
      return {
        code: pollPayloads.length === 1 ? '111111' : '222222',
        emailTimestamp: pollPayloads.length,
      };
    },
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'FILL_CODE') {
        submitCount += 1;
        return submitCount === 1
          ? { invalidCode: true, errorText: '旧验证码' }
          : {};
      }
      if (message.type === 'RESEND_VERIFICATION_CODE') {
        return {};
      }
      return {};
    },
    sendToMailContentScriptResilient: async () => ({}),
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    4,
    {
      email: 'user@example.com',
      signupVerificationRequestedAt: 100000,
      lastSignupCode: null,
    },
    { provider: 'hotmail-api', label: 'Hotmail' },
    {
      filterAfterTimestamp: 123456,
    }
  );

  assert.equal(pollPayloads.length, 2);
  assert.equal(pollPayloads[0].filterAfterTimestamp, 123456);
  assert.equal(pollPayloads[1].filterAfterTimestamp, 123456);
});

test('verification flow uses configured signup resend count for step 4', async () => {
  const resendSteps = [];
  let pollCalls = 0;

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'RESEND_VERIFICATION_CODE') {
        resendSteps.push(message.step);
      }
      return {};
    },
    sendToMailContentScriptResilient: async () => {
      pollCalls += 1;
      return pollCalls === 2
        ? { code: '654321', emailTimestamp: 123 }
        : {};
    },
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    4,
    {
      email: 'user@example.com',
      verificationResendCount: 2,
      lastSignupCode: null,
    },
    { provider: 'qq', label: 'QQ 邮箱' },
    {
      requestFreshCodeFirst: true,
      resendIntervalMs: 0,
    }
  );

  assert.deepStrictEqual(resendSteps, [4, 4]);
  assert.equal(pollCalls, 2);
});

test('verification flow uses configured login resend count for step 8', async () => {
  const resendSteps = [];
  let pollCalls = 0;

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeStepFromBackground: async () => {},
    confirmCustomVerificationStepBypassRequest: async () => ({ confirmed: true }),
    getHotmailVerificationPollConfig: () => ({}),
    getHotmailVerificationRequestTimestamp: () => 0,
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isStopError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
    pollCloudflareTempEmailVerificationCode: async () => ({}),
    pollHotmailVerificationCode: async () => ({}),
    pollLuckmailVerificationCode: async () => ({}),
    sendToContentScript: async (_source, message) => {
      if (message.type === 'RESEND_VERIFICATION_CODE') {
        resendSteps.push(message.step);
      }
      return {};
    },
    sendToMailContentScriptResilient: async () => {
      pollCalls += 1;
      return pollCalls === 3
        ? { code: '654321', emailTimestamp: 123 }
        : {};
    },
    setState: async () => {},
    setStepStatus: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    VERIFICATION_POLL_MAX_ROUNDS: 5,
  });

  await helpers.resolveVerificationStep(
    8,
    {
      email: 'user@example.com',
      verificationResendCount: 2,
      lastLoginCode: null,
    },
    { provider: 'qq', label: 'QQ 邮箱' },
    {
      requestFreshCodeFirst: false,
      resendIntervalMs: 0,
    }
  );

  assert.deepStrictEqual(resendSteps, [8, 8]);
  assert.equal(pollCalls, 3);
});
