(function attachSidepanelOutlookEmailManager(globalScope) {
  function createOutlookEmailManager(context = {}) {
    const {
      state,
      dom,
      helpers,
      runtime,
      utils = {},
    } = context;

    const normalizeBaseUrl = utils.normalizeOutlookEmailBaseUrl
      || ((value) => String(value || '').trim());
    const normalizeGroupId = utils.normalizeOutlookEmailGroupId
      || ((value) => String(value || '').trim());
    const normalizeGroups = utils.normalizeOutlookEmailGroups
      || ((value) => Array.isArray(value) ? value : []);

    let fetchGroupsInFlight = false;

    function getGroups(currentState = state.getLatestState()) {
      return normalizeGroups(currentState?.outlookEmailGroups || []);
    }

    function updateGroupStatusText(text = '') {
      if (!dom.outlookEmailGroupStatus) {
        return;
      }
      dom.outlookEmailGroupStatus.textContent = text;
    }

    function renderGroupSelect(select, groups, selectedGroupId, placeholder) {
      if (!select) {
        return;
      }

      const normalizedSelectedGroupId = normalizeGroupId(selectedGroupId);
      const options = [`<option value="">${helpers.escapeHtml(placeholder)}</option>`];
      groups.forEach((group) => {
        options.push(
          `<option value="${helpers.escapeHtml(group.id)}">${helpers.escapeHtml(group.name)}${group.accountCount > 0 ? `（${helpers.escapeHtml(group.accountCount)}）` : ''}</option>`
        );
      });

      if (normalizedSelectedGroupId && !groups.some((group) => group.id === normalizedSelectedGroupId)) {
        options.push(
          `<option value="${helpers.escapeHtml(normalizedSelectedGroupId)}">当前分组 #${helpers.escapeHtml(normalizedSelectedGroupId)}（请重新拉取）</option>`
        );
      }

      select.innerHTML = options.join('');
      select.value = normalizedSelectedGroupId || '';
    }

    function renderGroups(currentState = state.getLatestState()) {
      const groups = getGroups(currentState);
      renderGroupSelect(
        dom.selectOutlookEmailSourceGroup,
        groups,
        currentState?.outlookEmailSourceGroupId,
        '请选择注册邮箱池分组'
      );
      renderGroupSelect(
        dom.selectOutlookEmailSuccessGroup,
        groups,
        currentState?.outlookEmailSuccessGroupId,
        '请选择注册成功分组'
      );

      if (groups.length > 0) {
        updateGroupStatusText(`已载入 ${groups.length} 个分组`);
      } else {
        updateGroupStatusText('未拉取分组');
      }
    }

    function collectSettings() {
      return {
        outlookEmailBaseUrl: normalizeBaseUrl(dom.inputOutlookEmailBaseUrl?.value),
        outlookEmailPassword: String(dom.inputOutlookEmailPassword?.value || ''),
        outlookEmailSourceGroupId: normalizeGroupId(dom.selectOutlookEmailSourceGroup?.value),
        outlookEmailSuccessGroupId: normalizeGroupId(dom.selectOutlookEmailSuccessGroup?.value),
      };
    }

    function applySettingsState(currentState = {}) {
      if (dom.inputOutlookEmailBaseUrl) {
        dom.inputOutlookEmailBaseUrl.value = currentState?.outlookEmailBaseUrl || '';
      }
      if (dom.inputOutlookEmailPassword) {
        dom.inputOutlookEmailPassword.value = currentState?.outlookEmailPassword || '';
      }
      renderGroups(currentState);
    }

    async function handleFetchGroups() {
      if (fetchGroupsInFlight) {
        return;
      }

      fetchGroupsInFlight = true;
      if (dom.btnFetchOutlookEmailGroups) {
        dom.btnFetchOutlookEmailGroups.disabled = true;
        dom.btnFetchOutlookEmailGroups.textContent = '拉取中';
      }

      try {
        const draft = collectSettings();
        if (!draft.outlookEmailBaseUrl) {
          helpers.showToast('请先填写 OutlookEmail 服务地址。', 'warn');
          return;
        }
        if (!draft.outlookEmailPassword) {
          helpers.showToast('请先填写 OutlookEmail 登录密码。', 'warn');
          return;
        }

        await helpers.saveSettings({ silent: true });

        const response = await runtime.sendMessage({
          type: 'FETCH_OUTLOOKEMAIL_GROUPS',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) {
          throw new Error(response.error);
        }

        const nextState = {
          ...state.getLatestState(),
          outlookEmailGroups: normalizeGroups(response?.groups || []),
        };
        state.syncLatestState(nextState);
        renderGroups(nextState);
        helpers.showToast(`已拉取 ${nextState.outlookEmailGroups.length} 个 OutlookEmail 分组`, 'success', 1800);
      } catch (error) {
        const message = error?.message || String(error || '拉取分组失败');
        updateGroupStatusText('拉取失败');
        helpers.showToast(`拉取 OutlookEmail 分组失败：${message}`, 'error');
      } finally {
        fetchGroupsInFlight = false;
        if (dom.btnFetchOutlookEmailGroups) {
          dom.btnFetchOutlookEmailGroups.disabled = false;
          dom.btnFetchOutlookEmailGroups.textContent = '拉取分组';
        }
      }
    }

    function bindAutoSaveInput(input) {
      input?.addEventListener('input', () => {
        updateGroupStatusText('配置已变更，请重新拉取分组');
        helpers.markSettingsDirty(true);
        helpers.scheduleSettingsAutoSave();
      });
      input?.addEventListener('blur', () => {
        helpers.saveSettings({ silent: true }).catch(() => { });
      });
    }

    function bindAutoSaveSelect(select) {
      select?.addEventListener('change', () => {
        helpers.markSettingsDirty(true);
        helpers.saveSettings({ silent: true }).catch(() => { });
      });
    }

    function bindEvents() {
      dom.btnFetchOutlookEmailGroups?.addEventListener('click', () => {
        handleFetchGroups().catch(() => { });
      });

      bindAutoSaveInput(dom.inputOutlookEmailBaseUrl);
      bindAutoSaveInput(dom.inputOutlookEmailPassword);
      bindAutoSaveSelect(dom.selectOutlookEmailSourceGroup);
      bindAutoSaveSelect(dom.selectOutlookEmailSuccessGroup);
    }

    return {
      applySettingsState,
      bindEvents,
      collectSettings,
      renderGroups,
    };
  }

  globalScope.SidepanelOutlookEmailManager = {
    createOutlookEmailManager,
  };
})(typeof window !== 'undefined' ? window : globalThis);
