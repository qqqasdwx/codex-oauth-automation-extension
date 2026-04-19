const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../hero-sms-utils.js');

function createStorageLocal(initialState = {}) {
  const store = { ...initialState };
  return {
    store,
    async get(key) {
      if (Array.isArray(key)) {
        return key.reduce((result, currentKey) => {
          result[currentKey] = store[currentKey];
          return result;
        }, {});
      }
      if (typeof key === 'string') {
        return { [key]: store[key] };
      }
      return { ...store };
    },
    async set(updates = {}) {
      Object.assign(store, updates);
    },
  };
}

function createJsonResponse(payload) {
  return {
    headers: {
      get(name) {
        return name === 'content-type' ? 'application/json' : '';
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test('hero sms utils deduplicate phone codes and cap each number at three codes', async () => {
  const storage = createStorageLocal();
  global.chrome = { storage: { local: storage } };
  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');

  let result = await utils.appendPhoneCodeIfNew('+8520001111', '111111');
  assert.equal(result.added, true);
  result = await utils.appendPhoneCodeIfNew('8520001111', '111111');
  assert.equal(result.duplicate, true);
  await utils.appendPhoneCodeIfNew('8520001111', '222222');
  result = await utils.appendPhoneCodeIfNew('8520001111', '333333');
  assert.equal(result.exhausted, true);
  result = await utils.appendPhoneCodeIfNew('8520001111', '444444');
  assert.equal(result.exhausted, true);
  assert.deepStrictEqual(
    storage.store.heroSmsPhoneRecords['8520001111'],
    ['111111', '222222', '333333']
  );

  delete global.chrome;
});

test('hero sms utils reuse existing activation before requesting a new number', async () => {
  const storage = createStorageLocal({
    heroSmsPhoneRecords: {
      '8520001111': ['111111'],
      '8520002222': ['111111', '222222', '333333'],
    },
  });
  const fetchCalls = [];

  global.chrome = { storage: { local: storage } };
  global.fetch = async (url) => {
    fetchCalls.push(url);
    const parsed = new URL(url);
    const action = parsed.searchParams.get('action');
    if (action === 'getActiveActivations') {
      return createJsonResponse({
        status: 'success',
        data: [
          {
            activationId: 'act-reusable',
            phoneNumber: '+8520001111',
            countryCode: '852',
            serviceCode: 'dr',
            activationTime: '2026-04-19T00:00:00Z',
          },
          {
            activationId: 'act-exhausted',
            phoneNumber: '+8520002222',
            countryCode: '852',
            serviceCode: 'dr',
            activationTime: '2026-04-19T01:00:00Z',
          },
        ],
      });
    }
    if (action === 'setStatus') {
      return createJsonResponse({ ok: true });
    }
    throw new Error(`unexpected action ${action}`);
  };

  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');
  const activation = await utils.findOrCreateSmsActivation('demo-key', '852');

  assert.deepStrictEqual(activation, {
    activationId: 'act-reusable',
    phoneNumber: '+8520001111',
  });
  assert.equal(fetchCalls.some((url) => String(url).includes('action=getNumberV2')), false);
  assert.ok(fetchCalls.some((url) => String(url).includes('action=setStatus') && String(url).includes('id=act-reusable')));

  delete global.chrome;
  delete global.fetch;
});

test('hero sms utils skip blocked activation numbers and request a fresh number', async () => {
  const storage = createStorageLocal({
    heroSmsPhoneRecords: {
      '8520001111': ['111111'],
    },
    heroSmsBlockedPhoneRecords: {
      '8520001111': Date.now() + 60_000,
    },
  });
  const fetchCalls = [];

  global.chrome = { storage: { local: storage } };
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    const parsed = new URL(url);
    const action = parsed.searchParams.get('action');
    if (action === 'getActiveActivations') {
      return createJsonResponse({
        status: 'success',
        data: [
          {
            activationId: 'act-blocked',
            phoneNumber: '+8520001111',
            countryCode: '852',
            serviceCode: 'dr',
            activationTime: '2026-04-19T02:00:00Z',
          },
        ],
      });
    }
    if (action === 'getNumberV2') {
      return createJsonResponse({
        activationId: 'act-new',
        phoneNumber: '+8520003333',
      });
    }
    if (action === 'setStatus') {
      return createJsonResponse({ ok: true });
    }
    throw new Error(`unexpected action ${action}`);
  };

  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');
  const activation = await utils.findOrCreateSmsActivation('demo-key', '852');

  assert.deepStrictEqual(activation, {
    activationId: 'act-new',
    phoneNumber: '+8520003333',
  });
  assert.ok(fetchCalls.some((url) => url.includes('action=getNumberV2')));

  delete global.chrome;
  delete global.fetch;
});

test('hero sms utils pollSmsVerificationCode returns new code and finishes exhausted activation only after the third code', async () => {
  const storage = createStorageLocal({
    heroSmsPhoneRecords: {
      '8520001111': ['111111', '222222'],
    },
  });
  const fetchCalls = [];
  const logs = [];

  global.chrome = { storage: { local: storage } };
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    const parsed = new URL(url);
    const action = parsed.searchParams.get('action');
    if (action === 'getActiveActivations') {
      return createJsonResponse({
        status: 'success',
        data: [
          {
            activationId: 'act-3',
            phoneNumber: '+8520001111',
            smsCode: '333333',
          },
        ],
      });
    }
    if (action === 'finishActivation') {
      return createJsonResponse({ success: true });
    }
    throw new Error(`unexpected action ${action}`);
  };

  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');
  const code = await utils.pollSmsVerificationCode(
    'demo-key',
    'act-3',
    async (step, message, level) => {
      logs.push({ step, message, level });
    },
    9
  );

  assert.equal(code, '333333');
  assert.deepStrictEqual(storage.store.heroSmsPhoneRecords['8520001111'], ['111111', '222222', '333333']);
  assert.ok(fetchCalls.some((url) => url.includes('action=finishActivation') && url.includes('id=act-3')));
  assert.ok(logs.some(({ message }) => /已获取短信验证码：333333/.test(message)));
  assert.ok(logs.some(({ message }) => /已达到 3 次接码上限/.test(message)));

  delete global.chrome;
  delete global.fetch;
});

test('hero sms utils pollSmsVerificationCode respects stopCheck interruption', async () => {
  const storage = createStorageLocal();

  global.chrome = { storage: { local: storage } };
  global.fetch = async () => {
    throw new Error('fetch should not run after stopCheck interruption');
  };

  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');

  await assert.rejects(
    utils.pollSmsVerificationCode(
      'demo-key',
      'act-stop',
      async () => {},
      9,
      async () => {
        throw new Error('流程已被用户停止。');
      }
    ),
    /流程已被用户停止/
  );

  delete global.chrome;
  delete global.fetch;
});

test('hero sms utils pollSmsVerificationCode cancels activation after first code timeout and blocks the number', async () => {
  const storage = createStorageLocal();
  const fetchCalls = [];
  const logs = [];

  global.chrome = { storage: { local: storage } };
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    const parsed = new URL(url);
    const action = parsed.searchParams.get('action');
    if (action === 'getActiveActivations') {
      return createJsonResponse({
        status: 'success',
        data: [
          {
            activationId: 'act-timeout',
            phoneNumber: '+8520009999',
            smsCode: '',
          },
        ],
      });
    }
    if (action === 'setStatus' && parsed.searchParams.get('status') === '8') {
      return createJsonResponse({
        title: 'CANCELED',
        details: 'Activation canceled.',
      });
    }
    throw new Error(`unexpected action ${action}`);
  };

  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');

  await assert.rejects(
    utils.pollSmsVerificationCode(
      'demo-key',
      'act-timeout',
      async (step, message, level) => {
        logs.push({ step, message, level });
      },
      9,
      async () => {},
      {
        initialPhoneNumber: '+8520009999',
        firstCodeTimeoutMs: 15,
        pollIntervalMs: 5,
        maxDurationMs: 50,
      }
    ),
    /HERO_SMS_FIRST_CODE_TIMEOUT::/
  );

  assert.ok(fetchCalls.some((url) => url.includes('action=setStatus') && url.includes('status=8')));
  assert.equal(typeof storage.store.heroSmsBlockedPhoneRecords?.['8520009999'], 'number');
  assert.ok(logs.some(({ message }) => /未收到任何验证码/.test(message)));
  assert.ok(logs.some(({ message }) => /已取消当前 Hero-SMS activation/.test(message)));

  delete global.chrome;
  delete global.fetch;
});
