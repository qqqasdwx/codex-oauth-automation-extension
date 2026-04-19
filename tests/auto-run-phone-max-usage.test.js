const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);

test('auto-run controller skips phone_max_usage_exceeded to the next round without retrying the same round', async () => {
  const events = {
    logs: [],
    broadcasts: [],
    accountRecords: [],
    runCalls: 0,
  };

  let currentState = {
    stepStatuses: {},
    vpsUrl: 'https://example.com/vps',
    vpsPassword: 'secret',
    customPassword: '',
    autoRunSkipFailures: true,
    autoRunFallbackThreadIntervalMinutes: 0,
    autoRunDelayEnabled: false,
    autoRunDelayMinutes: 30,
    autoStepDelaySeconds: null,
    mailProvider: '163',
    emailGenerator: 'duck',
    gmailBaseEmail: '',
    mail2925BaseEmail: '',
    emailPrefix: 'demo',
    inbucketHost: '',
    inbucketMailbox: '',
    cloudflareDomain: '',
    cloudflareDomains: [],
    tabRegistry: {},
    sourceLastUrls: {},
    autoRunRoundSummaries: [],
  };

  const runtime = {
    state: {
      autoRunActive: false,
      autoRunCurrentRun: 0,
      autoRunTotalRuns: 1,
      autoRunAttemptRun: 0,
      autoRunSessionId: 0,
    },
    get() {
      return { ...this.state };
    },
    set(updates = {}) {
      this.state = { ...this.state, ...updates };
    },
  };

  let sessionSeed = 0;

  const controller = api.createAutoRunController({
    addLog: async (message, level = 'info') => {
      events.logs.push({ message, level });
    },
    appendAccountRunRecord: async (status, _state, reason) => {
      events.accountRecords.push({ status, reason });
      return { status, reason };
    },
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 3,
    AUTO_RUN_RETRY_DELAY_MS: 3000,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    broadcastAutoRunStatus: async (phase, payload = {}) => {
      events.broadcasts.push({ phase, ...payload });
      currentState = {
        ...currentState,
        autoRunning: ['scheduled', 'running', 'waiting_step', 'waiting_email', 'retrying', 'waiting_interval'].includes(phase),
        autoRunPhase: phase,
        autoRunCurrentRun: payload.currentRun ?? runtime.state.autoRunCurrentRun,
        autoRunTotalRuns: payload.totalRuns ?? runtime.state.autoRunTotalRuns,
        autoRunAttemptRun: payload.attemptRun ?? runtime.state.autoRunAttemptRun,
        autoRunSessionId: payload.sessionId ?? runtime.state.autoRunSessionId,
      };
    },
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => {
      sessionSeed += 1;
      return sessionSeed;
    },
    getAutoRunStatusPayload: (phase, payload = {}) => ({
      autoRunning: ['scheduled', 'running', 'waiting_step', 'waiting_email', 'retrying', 'waiting_interval'].includes(phase),
      autoRunPhase: phase,
      autoRunCurrentRun: payload.currentRun ?? 0,
      autoRunTotalRuns: payload.totalRuns ?? 1,
      autoRunAttemptRun: payload.attemptRun ?? 0,
      autoRunSessionId: payload.sessionId ?? 0,
    }),
    getErrorMessage: (error) => error?.message || String(error || ''),
    getFirstUnfinishedStep: () => 1,
    getPendingAutoRunTimerPlan: () => null,
    getRunningSteps: () => [],
    getState: async () => ({
      ...currentState,
      stepStatuses: { ...(currentState.stepStatuses || {}) },
      tabRegistry: { ...(currentState.tabRegistry || {}) },
      sourceLastUrls: { ...(currentState.sourceLastUrls || {}) },
    }),
    getStopRequested: () => false,
    hasSavedProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isPhoneMaxUsageExceededError: (error) => /PHONE_MAX_USAGE_EXCEEDED::/.test(error?.message || String(error || '')),
    isRestartCurrentAttemptError: () => false,
    isStopError: (error) => (error?.message || String(error || '')) === '流程已被用户停止。',
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    persistAutoRunTimerPlan: async () => ({}),
    resetState: async () => {
      currentState = {
        ...currentState,
        stepStatuses: {},
        tabRegistry: {},
        sourceLastUrls: {},
      };
    },
    runAutoSequenceFromStep: async () => {
      events.runCalls += 1;
      if (events.runCalls === 1) {
        throw new Error('PHONE_MAX_USAGE_EXCEEDED::phone_max_usage_exceeded');
      }
    },
    runtime,
    setState: async (updates = {}) => {
      currentState = {
        ...currentState,
        ...updates,
        stepStatuses: updates.stepStatuses ? { ...updates.stepStatuses } : currentState.stepStatuses,
        tabRegistry: updates.tabRegistry ? { ...updates.tabRegistry } : currentState.tabRegistry,
        sourceLastUrls: updates.sourceLastUrls ? { ...updates.sourceLastUrls } : currentState.sourceLastUrls,
      };
    },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: (sessionId) => {
      if (sessionId && sessionId !== runtime.state.autoRunSessionId) {
        throw new Error('流程已被用户停止。');
      }
    },
    waitForRunningStepsToFinish: async () => currentState,
    chrome: {
      runtime: {
        sendMessage() {
          return Promise.resolve();
        },
      },
    },
  });

  await controller.autoRunLoop(2, {
    autoRunSkipFailures: true,
    mode: 'restart',
  });

  assert.equal(events.runCalls, 2, 'phone_max_usage_exceeded should skip the current round and continue with the next round');
  assert.equal(events.broadcasts.some(({ phase }) => phase === 'retrying'), false, 'phone_max_usage_exceeded should not enter retrying phase');
  assert.equal(events.accountRecords.length, 1);
  assert.equal(events.accountRecords[0].status, 'failed');
  assert.match(events.accountRecords[0].reason, /PHONE_MAX_USAGE_EXCEEDED/);
  assert.ok(events.logs.some(({ message }) => /phone_max_usage_exceeded/.test(message)));
  assert.equal(runtime.state.autoRunActive, false);
  assert.equal(runtime.state.autoRunSessionId, 0);
});

test('auto-run controller retries the same round on hero sms code timeout', async () => {
  const events = {
    logs: [],
    broadcasts: [],
    accountRecords: [],
    runCalls: 0,
  };

  let currentState = {
    stepStatuses: {},
    vpsUrl: 'https://example.com/vps',
    vpsPassword: 'secret',
    customPassword: '',
    autoRunSkipFailures: true,
    autoRunFallbackThreadIntervalMinutes: 0,
    autoRunDelayEnabled: false,
    autoRunDelayMinutes: 30,
    autoStepDelaySeconds: null,
    mailProvider: '163',
    emailGenerator: 'duck',
    gmailBaseEmail: '',
    mail2925BaseEmail: '',
    emailPrefix: 'demo',
    inbucketHost: '',
    inbucketMailbox: '',
    cloudflareDomain: '',
    cloudflareDomains: [],
    tabRegistry: {},
    sourceLastUrls: {},
    autoRunRoundSummaries: [],
  };

  const runtime = {
    state: {
      autoRunActive: false,
      autoRunCurrentRun: 0,
      autoRunTotalRuns: 1,
      autoRunAttemptRun: 0,
      autoRunSessionId: 0,
    },
    get() {
      return { ...this.state };
    },
    set(updates = {}) {
      this.state = { ...this.state, ...updates };
    },
  };

  let sessionSeed = 0;

  const controller = api.createAutoRunController({
    addLog: async (message, level = 'info') => {
      events.logs.push({ message, level });
    },
    appendAccountRunRecord: async (status, _state, reason) => {
      events.accountRecords.push({ status, reason });
      return { status, reason };
    },
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 3,
    AUTO_RUN_RETRY_DELAY_MS: 0,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    broadcastAutoRunStatus: async (phase, payload = {}) => {
      events.broadcasts.push({ phase, ...payload });
      currentState = {
        ...currentState,
        autoRunning: ['scheduled', 'running', 'waiting_step', 'waiting_email', 'retrying', 'waiting_interval'].includes(phase),
        autoRunPhase: phase,
        autoRunCurrentRun: payload.currentRun ?? runtime.state.autoRunCurrentRun,
        autoRunTotalRuns: payload.totalRuns ?? runtime.state.autoRunTotalRuns,
        autoRunAttemptRun: payload.attemptRun ?? runtime.state.autoRunAttemptRun,
        autoRunSessionId: payload.sessionId ?? runtime.state.autoRunSessionId,
      };
    },
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => {
      sessionSeed += 1;
      return sessionSeed;
    },
    getAutoRunStatusPayload: (phase, payload = {}) => ({
      autoRunning: ['scheduled', 'running', 'waiting_step', 'waiting_email', 'retrying', 'waiting_interval'].includes(phase),
      autoRunPhase: phase,
      autoRunCurrentRun: payload.currentRun ?? 0,
      autoRunTotalRuns: payload.totalRuns ?? 1,
      autoRunAttemptRun: payload.attemptRun ?? 0,
      autoRunSessionId: payload.sessionId ?? 0,
    }),
    getErrorMessage: (error) => error?.message || String(error || ''),
    getFirstUnfinishedStep: () => 1,
    getPendingAutoRunTimerPlan: () => null,
    getRunningSteps: () => [],
    getState: async () => ({
      ...currentState,
      stepStatuses: { ...(currentState.stepStatuses || {}) },
      tabRegistry: { ...(currentState.tabRegistry || {}) },
      sourceLastUrls: { ...(currentState.sourceLastUrls || {}) },
    }),
    getStopRequested: () => false,
    hasSavedProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isHeroSmsFirstCodeTimeoutError: (error) => /HERO_SMS_(?:FIRST|NEXT)_CODE_TIMEOUT::/.test(error?.message || String(error || '')),
    isPhoneMaxUsageExceededError: () => false,
    isRestartCurrentAttemptError: () => false,
    isStopError: (error) => (error?.message || String(error || '')) === '流程已被用户停止。',
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    persistAutoRunTimerPlan: async () => ({}),
    resetState: async () => {
      currentState = {
        ...currentState,
        stepStatuses: {},
        tabRegistry: {},
        sourceLastUrls: {},
      };
    },
    runAutoSequenceFromStep: async () => {
      events.runCalls += 1;
      if (events.runCalls === 1) {
        throw new Error('HERO_SMS_NEXT_CODE_TIMEOUT::no_next_sms_in_180s');
      }
    },
    runtime,
    setState: async (updates = {}) => {
      currentState = {
        ...currentState,
        ...updates,
        stepStatuses: updates.stepStatuses ? { ...updates.stepStatuses } : currentState.stepStatuses,
        tabRegistry: updates.tabRegistry ? { ...updates.tabRegistry } : currentState.tabRegistry,
        sourceLastUrls: updates.sourceLastUrls ? { ...updates.sourceLastUrls } : currentState.sourceLastUrls,
      };
    },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: (sessionId) => {
      if (sessionId && sessionId !== runtime.state.autoRunSessionId) {
        throw new Error('流程已被用户停止。');
      }
    },
    waitForRunningStepsToFinish: async () => currentState,
    chrome: {
      runtime: {
        sendMessage() {
          return Promise.resolve();
        },
      },
    },
  });

  await controller.autoRunLoop(1, {
    autoRunSkipFailures: true,
    mode: 'restart',
  });

  assert.equal(events.runCalls, 2, 'hero sms code timeout should retry within the same round');
  assert.ok(events.broadcasts.some(({ phase }) => phase === 'retrying'));
  assert.equal(events.accountRecords.length, 0);
  assert.ok(events.logs.some(({ message }) => /Hero-SMS 验证码等待超时/.test(message)));
  assert.equal(runtime.state.autoRunActive, false);
  assert.equal(runtime.state.autoRunSessionId, 0);
});

test('auto-run controller stops immediately on hero sms code timeout when retries are disabled', async () => {
  const events = {
    logs: [],
    broadcasts: [],
    accountRecords: [],
    runCalls: 0,
  };

  let currentState = {
    stepStatuses: {},
    vpsUrl: 'https://example.com/vps',
    vpsPassword: 'secret',
    customPassword: '',
    autoRunSkipFailures: false,
    autoRunFallbackThreadIntervalMinutes: 0,
    autoRunDelayEnabled: false,
    autoRunDelayMinutes: 30,
    autoStepDelaySeconds: null,
    mailProvider: '163',
    emailGenerator: 'duck',
    gmailBaseEmail: '',
    mail2925BaseEmail: '',
    emailPrefix: 'demo',
    inbucketHost: '',
    inbucketMailbox: '',
    cloudflareDomain: '',
    cloudflareDomains: [],
    tabRegistry: {},
    sourceLastUrls: {},
    autoRunRoundSummaries: [],
  };

  const runtime = {
    state: {
      autoRunActive: false,
      autoRunCurrentRun: 0,
      autoRunTotalRuns: 1,
      autoRunAttemptRun: 0,
      autoRunSessionId: 0,
    },
    get() {
      return { ...this.state };
    },
    set(updates = {}) {
      this.state = { ...this.state, ...updates };
    },
  };

  let sessionSeed = 0;

  const controller = api.createAutoRunController({
    addLog: async (message, level = 'info') => {
      events.logs.push({ message, level });
    },
    appendAccountRunRecord: async (status, _state, reason) => {
      events.accountRecords.push({ status, reason });
      return { status, reason };
    },
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 3,
    AUTO_RUN_RETRY_DELAY_MS: 0,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    broadcastAutoRunStatus: async (phase, payload = {}) => {
      events.broadcasts.push({ phase, ...payload });
      currentState = {
        ...currentState,
        autoRunning: ['scheduled', 'running', 'waiting_step', 'waiting_email', 'retrying', 'waiting_interval'].includes(phase),
        autoRunPhase: phase,
        autoRunCurrentRun: payload.currentRun ?? runtime.state.autoRunCurrentRun,
        autoRunTotalRuns: payload.totalRuns ?? runtime.state.autoRunTotalRuns,
        autoRunAttemptRun: payload.attemptRun ?? runtime.state.autoRunAttemptRun,
        autoRunSessionId: payload.sessionId ?? runtime.state.autoRunSessionId,
      };
    },
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    clearStopRequest: () => {},
    createAutoRunSessionId: () => {
      sessionSeed += 1;
      return sessionSeed;
    },
    getAutoRunStatusPayload: (phase, payload = {}) => ({
      autoRunning: ['scheduled', 'running', 'waiting_step', 'waiting_email', 'retrying', 'waiting_interval'].includes(phase),
      autoRunPhase: phase,
      autoRunCurrentRun: payload.currentRun ?? 0,
      autoRunTotalRuns: payload.totalRuns ?? 1,
      autoRunAttemptRun: payload.attemptRun ?? 0,
      autoRunSessionId: payload.sessionId ?? 0,
    }),
    getErrorMessage: (error) => error?.message || String(error || ''),
    getFirstUnfinishedStep: () => 1,
    getPendingAutoRunTimerPlan: () => null,
    getRunningSteps: () => [],
    getState: async () => ({
      ...currentState,
      stepStatuses: { ...(currentState.stepStatuses || {}) },
      tabRegistry: { ...(currentState.tabRegistry || {}) },
      sourceLastUrls: { ...(currentState.sourceLastUrls || {}) },
    }),
    getStopRequested: () => false,
    hasSavedProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isHeroSmsFirstCodeTimeoutError: (error) => /HERO_SMS_(?:FIRST|NEXT)_CODE_TIMEOUT::/.test(error?.message || String(error || '')),
    isPhoneMaxUsageExceededError: () => false,
    isRestartCurrentAttemptError: () => false,
    isStopError: (error) => (error?.message || String(error || '')) === '流程已被用户停止。',
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    persistAutoRunTimerPlan: async () => ({}),
    resetState: async () => {
      currentState = {
        ...currentState,
        stepStatuses: {},
        tabRegistry: {},
        sourceLastUrls: {},
      };
    },
    runAutoSequenceFromStep: async () => {
      events.runCalls += 1;
      throw new Error('HERO_SMS_NEXT_CODE_TIMEOUT::no_next_sms_in_180s');
    },
    runtime,
    setState: async (updates = {}) => {
      currentState = {
        ...currentState,
        ...updates,
        stepStatuses: updates.stepStatuses ? { ...updates.stepStatuses } : currentState.stepStatuses,
        tabRegistry: updates.tabRegistry ? { ...updates.tabRegistry } : currentState.tabRegistry,
        sourceLastUrls: updates.sourceLastUrls ? { ...updates.sourceLastUrls } : currentState.sourceLastUrls,
      };
    },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: (sessionId) => {
      if (sessionId && sessionId !== runtime.state.autoRunSessionId) {
        throw new Error('流程已被用户停止。');
      }
    },
    waitForRunningStepsToFinish: async () => currentState,
    chrome: {
      runtime: {
        sendMessage() {
          return Promise.resolve();
        },
      },
    },
  });

  await controller.autoRunLoop(2, {
    autoRunSkipFailures: false,
    mode: 'restart',
  });

  assert.equal(events.runCalls, 1);
  assert.equal(events.broadcasts.some(({ phase }) => phase === 'retrying'), false);
  assert.equal(events.broadcasts.some(({ phase }) => phase === 'stopped'), true);
  assert.equal(events.accountRecords.length, 1);
  assert.equal(events.accountRecords[0].status, 'failed');
  assert.match(events.accountRecords[0].reason, /HERO_SMS_NEXT_CODE_TIMEOUT/);
  assert.equal(runtime.state.autoRunActive, false);
  assert.equal(runtime.state.autoRunSessionId, 0);
});
