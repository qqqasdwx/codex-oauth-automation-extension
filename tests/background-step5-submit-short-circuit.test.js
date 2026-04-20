const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/steps/fill-profile.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundStep5;`)(globalScope);

test('step 5 forwards generated profile data and relies on completion signal flow', async () => {
  const events = {
    logs: [],
    messages: [],
  };

  const executor = api.createStep5Executor({
    addLog: async (message, level) => {
      events.logs.push({ message, level: level || 'info' });
    },
    completeStepFromBackground: async () => {},
    generateRandomBirthday: () => ({ year: 2003, month: 6, day: 19 }),
    generateRandomName: () => ({ firstName: 'Test', lastName: 'User' }),
    sendToContentScript: async (source, message) => {
      events.messages.push({ source, message });
      return { accepted: true };
    },
  });

  await executor.executeStep5();

  assert.deepStrictEqual(events.messages, [
    {
      source: 'signup-page',
      message: {
        type: 'EXECUTE_STEP',
        step: 5,
        source: 'background',
        payload: {
          firstName: 'Test',
          lastName: 'User',
          year: 2003,
          month: 6,
          day: 19,
        },
      },
    },
  ]);
  assert.ok(events.logs.some(({ message }) => /已生成姓名 Test User/.test(message)));
});

test('step 5 completes immediately when step 4 has already marked signup profile as skipped', async () => {
  const events = {
    logs: [],
    messages: [],
    completions: [],
  };

  const executor = api.createStep5Executor({
    addLog: async (message, level) => {
      events.logs.push({ message, level: level || 'info' });
    },
    completeStepFromBackground: async (step, payload) => {
      events.completions.push({ step, payload });
    },
    generateRandomBirthday: () => ({ year: 2003, month: 6, day: 19 }),
    generateRandomName: () => ({ firstName: 'Test', lastName: 'User' }),
    sendToContentScript: async (source, message) => {
      events.messages.push({ source, message });
      return { accepted: true };
    },
  });

  await executor.executeStep5({
    skipSignupProfileStep: true,
  });

  assert.deepStrictEqual(events.messages, []);
  assert.deepStrictEqual(events.completions, [
    {
      step: 5,
      payload: {
        skippedProfileForExistingAccount: true,
        directProceedToStep6: true,
        branch: 'existing_account_login',
        landingState: '',
        url: '',
      },
    },
  ]);
  assert.equal(events.logs.some(({ message }) => /已注册账号分支/.test(message)), true);
});
