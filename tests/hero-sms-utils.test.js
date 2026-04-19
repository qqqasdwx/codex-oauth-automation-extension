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
  assert.equal(fetchCalls.some((url) => String(url).includes('action=setStatus')), false);

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
  assert.equal(fetchCalls.some((url) => url.includes('action=setStatus')), false);

  delete global.chrome;
  delete global.fetch;
});

test('hero sms utils skip locally exhausted activation numbers and request a fresh number', async () => {
  const storage = createStorageLocal({
    heroSmsPhoneRecords: {
      '8520001111': ['111111'],
    },
    heroSmsExhaustedPhoneRecords: {
      '8520001111': {
        exhaustedAt: Date.now(),
        reason: 'next_code_timeout',
        receivedCodeCount: 1,
      },
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
            activationId: 'act-exhausted',
            phoneNumber: '+8520001111',
            countryCode: '852',
            serviceCode: 'dr',
            activationTime: '2026-04-19T03:00:00Z',
          },
        ],
      });
    }
    if (action === 'getNumberV2') {
      return createJsonResponse({
        activationId: 'act-new',
        phoneNumber: '+8520004444',
      });
    }
    throw new Error(`unexpected action ${action}`);
  };

  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');
  const activation = await utils.findOrCreateSmsActivation('demo-key', '852');

  assert.deepStrictEqual(activation, {
    activationId: 'act-new',
    phoneNumber: '+8520004444',
  });
  assert.ok(fetchCalls.some((url) => url.includes('action=getNumberV2')));
  assert.equal(fetchCalls.some((url) => url.includes('action=setStatus')), false);

  delete global.chrome;
  delete global.fetch;
});

test('hero sms utils keep received codes separate from exhausted records', async () => {
  const exhaustedAt = Date.now();
  const storage = createStorageLocal({
    heroSmsPhoneRecords: {
      '8520005555': ['111111', '222222'],
    },
  });

  global.chrome = { storage: { local: storage } };
  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');

  await utils.markPhoneNumberExhausted('+8520005555', {
    exhaustedAt,
    reason: 'next_code_timeout',
    receivedCodeCount: 2,
  });
  const status = await utils.getPhoneRecordStatus('8520005555');

  assert.deepStrictEqual(storage.store.heroSmsPhoneRecords['8520005555'], ['111111', '222222']);
  assert.deepStrictEqual(storage.store.heroSmsExhaustedPhoneRecords['8520005555'], {
    exhaustedAt,
    reason: 'next_code_timeout',
    receivedCodeCount: 2,
  });
  assert.equal(status.localExhausted, true);
  assert.deepStrictEqual(status.codes, ['111111', '222222']);

  delete global.chrome;
});

test('hero sms utils prepareActivationForSmsRequest keeps first sms in default waiting state', async () => {
  const storage = createStorageLocal({
    heroSmsPhoneRecords: {
      '8520001010': [],
    },
  });
  const fetchCalls = [];

  global.chrome = { storage: { local: storage } };
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    const parsed = new URL(url);
    const action = parsed.searchParams.get('action');
    if (action === 'getStatusV2') {
      return createJsonResponse({
        status: 'STATUS_WAIT_CODE',
        message: 'Waiting for the first SMS',
      });
    }
    throw new Error(`unexpected action ${action}`);
  };

  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');
  const result = await utils.prepareActivationForSmsRequest('demo-key', 'act-first', '+8520001010');

  assert.equal(result.requestMode, 'first');
  assert.equal(result.receivedCodeCount, 0);
  assert.equal(result.currentStatus.token, 'STATUS_WAIT_CODE');
  assert.equal(result.statusSwitchResult, null);
  assert.equal(fetchCalls.some((url) => url.includes('action=setStatus')), false);

  delete global.chrome;
  delete global.fetch;
});

test('hero sms utils prepareActivationForSmsRequest switches activation to wait for a new sms on reused numbers', async () => {
  const storage = createStorageLocal({
    heroSmsPhoneRecords: {
      '8520002020': ['111111'],
    },
  });
  const fetchCalls = [];

  global.chrome = { storage: { local: storage } };
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    const parsed = new URL(url);
    const action = parsed.searchParams.get('action');
    if (action === 'getStatusV2') {
      return createJsonResponse({
        status: 'STATUS_WAIT_RETRY',
        message: 'Waiting for resend',
      });
    }
    if (action === 'setStatus' && parsed.searchParams.get('status') === '3') {
      return createJsonResponse({
        status: 'ACCESS_RETRY_GET',
      });
    }
    throw new Error(`unexpected action ${action}`);
  };

  delete require.cache[modulePath];
  const utils = require('../hero-sms-utils.js');
  const result = await utils.prepareActivationForSmsRequest('demo-key', 'act-retry', '+8520002020');

  assert.equal(result.requestMode, 'retry');
  assert.equal(result.receivedCodeCount, 1);
  assert.equal(result.currentStatus.token, 'STATUS_WAIT_RETRY');
  assert.equal(result.statusSwitchResult.token, 'ACCESS_RETRY_GET');
  assert.ok(fetchCalls.some((url) => url.includes('action=setStatus') && url.includes('status=3')));

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

test('hero sms utils pollSmsVerificationCode cancels activation after first code timeout and marks the number exhausted', async () => {
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
  assert.equal(storage.store.heroSmsBlockedPhoneRecords, undefined);
  assert.equal(typeof storage.store.heroSmsExhaustedPhoneRecords?.['8520009999']?.exhaustedAt, 'number');
  assert.equal(storage.store.heroSmsExhaustedPhoneRecords?.['8520009999']?.reason, 'first_code_timeout');
  assert.equal(storage.store.heroSmsExhaustedPhoneRecords?.['8520009999']?.receivedCodeCount, 0);
  assert.ok(logs.some(({ message }) => /未收到任何验证码/.test(message)));
  assert.ok(logs.some(({ message }) => /已取消当前 Hero-SMS activation/.test(message)));

  delete global.chrome;
  delete global.fetch;
});

test('hero sms utils pollSmsVerificationCode cancels activation after next code timeout when one code was received before', async () => {
  const storage = createStorageLocal({
    heroSmsPhoneRecords: {
      '8520007777': ['111111'],
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
            activationId: 'act-next-1',
            phoneNumber: '+8520007777',
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
      'act-next-1',
      async (step, message, level) => {
        logs.push({ step, message, level });
      },
      9,
      async () => {},
      {
        initialPhoneNumber: '+8520007777',
        nextCodeTimeoutMs: 20,
        pollIntervalMs: 5,
        maxDurationMs: 60,
        smsRequestStartedAt: Date.now(),
      }
    ),
    /HERO_SMS_NEXT_CODE_TIMEOUT::/
  );

  assert.ok(fetchCalls.some((url) => url.includes('action=setStatus') && url.includes('status=8')));
  assert.equal(storage.store.heroSmsExhaustedPhoneRecords?.['8520007777']?.reason, 'next_code_timeout');
  assert.equal(storage.store.heroSmsExhaustedPhoneRecords?.['8520007777']?.receivedCodeCount, 1);
  assert.ok(logs.some(({ message }) => /未收到新的验证码/.test(message)));

  delete global.chrome;
  delete global.fetch;
});

test('hero sms utils pollSmsVerificationCode cancels activation after next code timeout when two codes were received before', async () => {
  const storage = createStorageLocal({
    heroSmsPhoneRecords: {
      '8520008888': ['111111', '222222'],
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
            activationId: 'act-next-2',
            phoneNumber: '+8520008888',
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
      'act-next-2',
      async () => {},
      9,
      async () => {},
      {
        initialPhoneNumber: '+8520008888',
        nextCodeTimeoutMs: 20,
        pollIntervalMs: 5,
        maxDurationMs: 60,
        smsRequestStartedAt: Date.now(),
      }
    ),
    /HERO_SMS_NEXT_CODE_TIMEOUT::/
  );

  assert.ok(fetchCalls.some((url) => url.includes('action=setStatus') && url.includes('status=8')));
  assert.equal(storage.store.heroSmsExhaustedPhoneRecords?.['8520008888']?.reason, 'next_code_timeout');
  assert.equal(storage.store.heroSmsExhaustedPhoneRecords?.['8520008888']?.receivedCodeCount, 2);

  delete global.chrome;
  delete global.fetch;
});
