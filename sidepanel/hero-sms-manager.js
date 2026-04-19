(function attachSidepanelHeroSmsManager(globalScope) {
  function createHeroSmsManager(context = {}) {
    const {
      dom = {},
      helpers = {},
    } = context;

    let eventsBound = false;

    function normalizeHeroSmsEnabled(value) {
      return value === true || String(value || '').trim().toLowerCase() === 'true';
    }

    function getSelectedHeroSmsEnabled() {
      const activeButton = (Array.isArray(dom.heroSmsEnabledButtons) ? dom.heroSmsEnabledButtons : [])
        .find((button) => button.classList?.contains?.('is-active'));
      return normalizeHeroSmsEnabled(activeButton?.dataset?.heroSmsEnabled);
    }

    function syncHeroSmsApiKeyToggleLabel() {
      if (typeof helpers.syncToggleButtonLabel === 'function') {
        helpers.syncToggleButtonLabel(dom.btnToggleHeroSmsApiKey, dom.inputHeroSmsApiKey, {
          show: '显示 SMS-APIKey',
          hide: '隐藏 SMS-APIKey',
        });
      }
    }

    function updateHeroSmsVisibility() {
      const enabled = getSelectedHeroSmsEnabled();
      if (dom.rowHeroSmsApiKey) {
        dom.rowHeroSmsApiKey.style.display = enabled ? '' : 'none';
      }
      if (dom.rowHeroSmsCountry) {
        dom.rowHeroSmsCountry.style.display = enabled ? '' : 'none';
      }
      syncHeroSmsApiKeyToggleLabel();
    }

    function setHeroSmsEnabled(enabled) {
      const resolved = normalizeHeroSmsEnabled(enabled);
      (Array.isArray(dom.heroSmsEnabledButtons) ? dom.heroSmsEnabledButtons : []).forEach((button) => {
        const active = normalizeHeroSmsEnabled(button?.dataset?.heroSmsEnabled) === resolved;
        button.classList?.toggle?.('is-active', active);
        button.setAttribute?.('aria-pressed', String(active));
      });
      updateHeroSmsVisibility();
    }

    function collectSettingsPayload() {
      return {
        heroSmsEnabled: getSelectedHeroSmsEnabled(),
        heroSmsApiKey: String(dom.inputHeroSmsApiKey?.value || '').trim(),
        heroSmsCountry: String(dom.inputHeroSmsCountry?.value || '').trim(),
      };
    }

    function applySettingsState(state = {}) {
      setHeroSmsEnabled(state?.heroSmsEnabled);
      if (dom.inputHeroSmsApiKey) {
        dom.inputHeroSmsApiKey.value = state?.heroSmsApiKey || '';
      }
      if (dom.inputHeroSmsCountry) {
        dom.inputHeroSmsCountry.value = state?.heroSmsCountry || '';
      }
      updateHeroSmsVisibility();
    }

    function markDirtyAndAutoSave() {
      if (typeof helpers.markSettingsDirty === 'function') {
        helpers.markSettingsDirty(true);
      }
      if (typeof helpers.scheduleSettingsAutoSave === 'function') {
        helpers.scheduleSettingsAutoSave();
      }
    }

    function saveSettingsSilently() {
      if (typeof helpers.markSettingsDirty === 'function') {
        helpers.markSettingsDirty(true);
      }
      if (typeof helpers.saveSettings === 'function') {
        helpers.saveSettings({ silent: true }).catch(() => { });
      }
    }

    function bindHeroSmsEvents() {
      if (eventsBound) {
        return;
      }
      eventsBound = true;

      (Array.isArray(dom.heroSmsEnabledButtons) ? dom.heroSmsEnabledButtons : []).forEach((button) => {
        button.addEventListener?.('click', () => {
          const nextEnabled = normalizeHeroSmsEnabled(button?.dataset?.heroSmsEnabled);
          setHeroSmsEnabled(nextEnabled);
          saveSettingsSilently();
        });
      });

      dom.btnToggleHeroSmsApiKey?.addEventListener?.('click', () => {
        if (!dom.inputHeroSmsApiKey) {
          return;
        }
        dom.inputHeroSmsApiKey.type = dom.inputHeroSmsApiKey.type === 'password' ? 'text' : 'password';
        syncHeroSmsApiKeyToggleLabel();
      });

      dom.btnQueryHeroSmsCountries?.addEventListener?.('click', () => {
        if (typeof helpers.openExternalUrl === 'function') {
          helpers.openExternalUrl('https://hero-sms.com/stubs/handler_api.php?action=getCountries');
        }
      });

      dom.inputHeroSmsApiKey?.addEventListener?.('input', markDirtyAndAutoSave);
      dom.inputHeroSmsCountry?.addEventListener?.('input', markDirtyAndAutoSave);
      dom.inputHeroSmsApiKey?.addEventListener?.('change', saveSettingsSilently);
      dom.inputHeroSmsCountry?.addEventListener?.('change', saveSettingsSilently);

      updateHeroSmsVisibility();
    }

    return {
      applySettingsState,
      bindHeroSmsEvents,
      collectSettingsPayload,
      getSelectedHeroSmsEnabled,
      setHeroSmsEnabled,
      syncHeroSmsApiKeyToggleLabel,
      updateHeroSmsVisibility,
    };
  }

  globalScope.SidepanelHeroSmsManager = {
    createHeroSmsManager,
  };
})(typeof window !== 'undefined' ? window : globalThis);
