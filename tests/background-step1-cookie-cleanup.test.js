const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('step 1 runs cookie cleanup, closes old signup tabs, then opens ChatGPT and completes', async () => {
  const source = fs.readFileSync('background/steps/open-chatgpt.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundStep1;`)(globalScope);

  const events = [];

  const executor = api.createStep1Executor({
    addLog: async (message) => {
      events.push(['log', message]);
    },
    completeStepFromBackground: async (step) => {
      events.push(['complete', step]);
    },
    openSignupEntryTab: async (step) => {
      events.push(['open', step]);
    },
    runPreStep1CookieCleanup: async () => {
      events.push(['cleanup']);
    },
    resetSignupEntryEnvironment: async () => {
      events.push(['reset']);
    },
  });

  await executor.executeStep1();

  assert.deepStrictEqual(events, [
    ['cleanup'],
    ['reset'],
    ['log', '步骤 1：正在打开 ChatGPT 官网...'],
    ['open', 1],
    ['complete', 1],
  ]);
});
