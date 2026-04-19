const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('sidepanel/hero-sms-manager.js', 'utf8');

function createClassList() {
  const classes = new Set();
  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    contains(name) {
      return classes.has(name);
    },
    toggle(name, force) {
      if (force === undefined) {
        if (classes.has(name)) {
          classes.delete(name);
          return false;
        }
        classes.add(name);
        return true;
      }
      if (force) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
      return force;
    },
  };
}

function createEventTarget(initial = {}) {
  const listeners = new Map();
  return {
    ...initial,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type) {
      const handler = listeners.get(type);
      if (handler) {
        handler({ target: this });
      }
    },
    click() {
      this.dispatch('click');
    },
  };
}

test('hero sms manager exposes a factory and handles collect/apply/bind flows', async () => {
  const windowObject = {};
  const api = new Function('window', `${source}; return window.SidepanelHeroSmsManager;`)(windowObject);

  assert.equal(typeof api?.createHeroSmsManager, 'function');

  const enableButton = createEventTarget({
    dataset: { heroSmsEnabled: 'true' },
    classList: createClassList(),
    setAttribute() {},
  });
  const disableButton = createEventTarget({
    dataset: { heroSmsEnabled: 'false' },
    classList: createClassList(),
    setAttribute() {},
  });
  const rowHeroSmsApiKey = { style: { display: 'none' } };
  const rowHeroSmsCountry = { style: { display: 'none' } };
  const inputHeroSmsApiKey = createEventTarget({ value: '', type: 'password' });
  const inputHeroSmsCountry = createEventTarget({ value: '' });
  const btnToggleHeroSmsApiKey = createEventTarget({ innerHTML: '', title: '' });
  const btnQueryHeroSmsCountries = createEventTarget({});

  let dirtyCount = 0;
  let autoSaveCount = 0;
  let saveCount = 0;
  let openedUrl = '';

  const manager = api.createHeroSmsManager({
    dom: {
      heroSmsEnabledButtons: [enableButton, disableButton],
      rowHeroSmsApiKey,
      rowHeroSmsCountry,
      inputHeroSmsApiKey,
      inputHeroSmsCountry,
      btnToggleHeroSmsApiKey,
      btnQueryHeroSmsCountries,
    },
    helpers: {
      markSettingsDirty() {
        dirtyCount += 1;
      },
      openExternalUrl(url) {
        openedUrl = url;
      },
      saveSettings: async () => {
        saveCount += 1;
      },
      scheduleSettingsAutoSave() {
        autoSaveCount += 1;
      },
      syncToggleButtonLabel(_button, input, labels) {
        btnToggleHeroSmsApiKey.title = input.type === 'password' ? labels.show : labels.hide;
      },
    },
  });

  assert.equal(typeof manager.collectSettingsPayload, 'function');
  assert.equal(typeof manager.applySettingsState, 'function');
  assert.equal(typeof manager.bindHeroSmsEvents, 'function');

  manager.applySettingsState({
    heroSmsEnabled: true,
    heroSmsApiKey: 'demo-key',
    heroSmsCountry: '52',
  });

  assert.equal(enableButton.classList.contains('is-active'), true);
  assert.equal(disableButton.classList.contains('is-active'), false);
  assert.equal(rowHeroSmsApiKey.style.display, '');
  assert.equal(rowHeroSmsCountry.style.display, '');
  assert.deepStrictEqual(manager.collectSettingsPayload(), {
    heroSmsEnabled: true,
    heroSmsApiKey: 'demo-key',
    heroSmsCountry: '52',
  });

  manager.bindHeroSmsEvents();
  disableButton.click();
  assert.equal(disableButton.classList.contains('is-active'), true);
  assert.equal(rowHeroSmsApiKey.style.display, 'none');
  assert.equal(saveCount, 1);

  inputHeroSmsApiKey.dispatch('input');
  inputHeroSmsCountry.dispatch('input');
  assert.equal(dirtyCount >= 2, true);
  assert.equal(autoSaveCount >= 2, true);

  btnToggleHeroSmsApiKey.click();
  assert.equal(inputHeroSmsApiKey.type, 'text');
  btnQueryHeroSmsCountries.click();
  assert.equal(openedUrl, 'https://hero-sms.com/stubs/handler_api.php?action=getCountries');
});
