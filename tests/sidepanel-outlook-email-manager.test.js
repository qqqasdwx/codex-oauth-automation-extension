const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('sidepanel loads outlook-email manager before sidepanel bootstrap', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const managerIndex = html.indexOf('<script src="outlook-email-manager.js"></script>');
  const sidepanelIndex = html.indexOf('<script src="sidepanel.js"></script>');

  assert.notEqual(managerIndex, -1);
  assert.notEqual(sidepanelIndex, -1);
  assert.ok(managerIndex < sidepanelIndex);
});

test('outlook-email manager exposes a factory and renders groups', () => {
  const source = fs.readFileSync('sidepanel/outlook-email-manager.js', 'utf8');
  const windowObject = {};
  const api = new Function('window', `${source}; return window.SidepanelOutlookEmailManager;`)(windowObject);

  assert.equal(typeof api?.createOutlookEmailManager, 'function');

  const selectSource = { innerHTML: '', value: '' };
  const selectSuccess = { innerHTML: '', value: '' };
  const manager = api.createOutlookEmailManager({
    state: {
      getLatestState: () => ({
        outlookEmailGroups: [{ id: '1', name: '注册池', accountCount: 5 }],
        outlookEmailSourceGroupId: '1',
        outlookEmailSuccessGroupId: '',
      }),
      syncLatestState() {},
    },
    dom: {
      btnFetchOutlookEmailGroups: { addEventListener() {}, disabled: false, textContent: '拉取分组' },
      inputOutlookEmailBaseUrl: { value: '', addEventListener() {} },
      inputOutlookEmailPassword: { value: '', addEventListener() {} },
      outlookEmailGroupStatus: { textContent: '' },
      selectOutlookEmailSourceGroup: selectSource,
      selectOutlookEmailSuccessGroup: selectSuccess,
    },
    helpers: {
      escapeHtml: (value) => String(value || ''),
      markSettingsDirty() {},
      saveSettings: async () => {},
      scheduleSettingsAutoSave() {},
      showToast() {},
    },
    runtime: {
      sendMessage: async () => ({ groups: [] }),
    },
    utils: {
      normalizeOutlookEmailBaseUrl: (value) => String(value || '').trim(),
      normalizeOutlookEmailGroupId: (value) => String(value || '').trim(),
      normalizeOutlookEmailGroups: (value) => Array.isArray(value) ? value : [],
    },
  });

  assert.equal(typeof manager.collectSettings, 'function');
  assert.equal(typeof manager.applySettingsState, 'function');
  assert.equal(typeof manager.renderGroups, 'function');
  assert.equal(typeof manager.bindEvents, 'function');

  manager.renderGroups();
  assert.match(selectSource.innerHTML, /注册池（5）/);
  assert.equal(selectSource.value, '1');
  assert.match(selectSuccess.innerHTML, /请选择注册成功分组/);
});
