const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports logging/status module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/logging-status\.js/);
});

test('logging/status module exposes a factory', () => {
  const source = fs.readFileSync('background/logging-status.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundLoggingStatus;`)(globalScope);

  assert.equal(typeof api?.createLoggingStatus, 'function');
  const status = api.createLoggingStatus({
    chrome: { runtime: { sendMessage: () => Promise.resolve() } },
    DEFAULT_STATE: { stepStatuses: {} },
    getState: async () => ({ logs: [], stepStatuses: {} }),
    isRecoverableStep9AuthFailure: () => false,
    LOG_PREFIX: '[test:bg]',
    setState: async () => {},
    STOP_ERROR_MESSAGE: '流程已被用户停止。',
  });
  assert.equal(typeof status?.isPhoneMaxUsageExceededError, 'function');
  assert.equal(typeof status?.isHeroSmsFirstCodeTimeoutError, 'function');
});

test('logging/status helper recognizes hero sms first code timeout errors', () => {
  const source = fs.readFileSync('background/logging-status.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundLoggingStatus;`)(globalScope);

  const status = api.createLoggingStatus({
    chrome: { runtime: { sendMessage: () => Promise.resolve() } },
    DEFAULT_STATE: { stepStatuses: {} },
    getState: async () => ({ logs: [], stepStatuses: {} }),
    isRecoverableStep9AuthFailure: () => false,
    LOG_PREFIX: '[test:bg]',
    setState: async () => {},
    STOP_ERROR_MESSAGE: '流程已被用户停止。',
  });

  assert.equal(status.isHeroSmsFirstCodeTimeoutError(new Error('HERO_SMS_FIRST_CODE_TIMEOUT::no_first_sms_in_125s')), true);
  assert.equal(status.isHeroSmsFirstCodeTimeoutError(new Error('PHONE_MAX_USAGE_EXCEEDED::phone_max_usage_exceeded')), false);
});
