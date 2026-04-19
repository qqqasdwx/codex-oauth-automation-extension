(function attachBackgroundPhoneVerification(root, factory) {
  root.MultiPageBackgroundPhoneVerification = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPhoneVerificationModule() {
  function createPhoneVerificationHelpers(deps = {}) {
    const {
      addLog,
      broadcastDataUpdate,
      chrome,
      clearLuckmailRuntimeState,
      getCurrentLuckmailPurchase,
      getErrorMessage = (error) => String(error?.message || error || ''),
      getState,
      heroFindOrCreateSmsActivation,
      heroFinishSmsActivation,
      heroPollSmsVerificationCode,
      heroPrepareActivationForSmsRequest,
      isHotmailProvider,
      isHeroSmsFirstCodeTimeoutError: sharedIsHeroSmsFirstCodeTimeoutError,
      isPhoneMaxUsageExceededError: sharedIsPhoneMaxUsageExceededError,
      isLuckmailProvider,
      patchHotmailAccount,
      setLuckmailPurchaseUsedState,
      setState,
      sleepWithStop,
      throwIfStopped,
    } = deps;

    const PHONE_MAX_USAGE_EXCEEDED_ERROR_CODE = 'PHONE_MAX_USAGE_EXCEEDED::phone_max_usage_exceeded';
    const HERO_SMS_FIRST_CODE_TIMEOUT_ERROR_CODE = 'HERO_SMS_FIRST_CODE_TIMEOUT::no_first_sms_in_120s';
    const HERO_SMS_NEXT_CODE_TIMEOUT_ERROR_CODE = 'HERO_SMS_NEXT_CODE_TIMEOUT::no_next_sms_in_180s';
    const ADD_PHONE_URL_PATTERN = /\/add-phone(?:[/?#]|$)/i;
    const PHONE_INPUT_SELECTOR = [
      'input#tel',
      'input[name*="phone" i]',
      'input[id*="phone" i]',
      'input[autocomplete="tel"]',
      'input[type="tel"]:not([maxlength="6"])',
    ].join(', ');
    const VERIFICATION_INPUT_SELECTOR = [
      'input[autocomplete="one-time-code"]',
      'input[inputmode="numeric"]',
      'input[name="code"]',
      'input[type="tel"][maxlength="6"]',
      'input[type="text"][maxlength="6"]',
    ].join(', ');
    const SPLIT_VERIFICATION_INPUT_SELECTOR = 'input[maxlength="1"]';
    const SUBMIT_BUTTON_SELECTOR = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button',
      '[role="button"]',
    ].join(', ');

    function fallbackIsPhoneMaxUsageExceededError(error) {
      const message = getErrorMessage(error);
      return /PHONE_MAX_USAGE_EXCEEDED::|phone[_\s-]*max[_\s-]*usage[_\s-]*exceeded/i.test(message);
    }

    const isPhoneMaxUsageExceededError = typeof sharedIsPhoneMaxUsageExceededError === 'function'
      ? sharedIsPhoneMaxUsageExceededError
      : fallbackIsPhoneMaxUsageExceededError;

    function fallbackIsHeroSmsFirstCodeTimeoutError(error) {
      const message = getErrorMessage(error);
      return /HERO_SMS_(?:FIRST|NEXT)_CODE_TIMEOUT::|hero[_\s-]*sms(?:[_\s-]*(?:first|next))?[_\s-]*code[_\s-]*timeout/i.test(message);
    }

    const isHeroSmsFirstCodeTimeoutError = typeof sharedIsHeroSmsFirstCodeTimeoutError === 'function'
      ? sharedIsHeroSmsFirstCodeTimeoutError
      : fallbackIsHeroSmsFirstCodeTimeoutError;

    function normalizeOpenAiPhoneNumber(phoneNumber) {
      const normalized = String(phoneNumber || '').trim();
      if (!normalized) {
        return '';
      }
      return normalized.startsWith('+') ? normalized : `+${normalized}`;
    }

    async function setHeroSmsRuntimeState(updates = {}) {
      const payload = {};
      if (updates.currentHeroSmsActivationId !== undefined) {
        payload.currentHeroSmsActivationId = updates.currentHeroSmsActivationId || null;
      }
      if (updates.currentHeroSmsPhoneNumber !== undefined) {
        payload.currentHeroSmsPhoneNumber = updates.currentHeroSmsPhoneNumber || null;
      }
      if (updates.currentHeroSmsActivationStartedAt !== undefined) {
        const normalizedStartedAt = Math.floor(Number(updates.currentHeroSmsActivationStartedAt) || 0);
        payload.currentHeroSmsActivationStartedAt = normalizedStartedAt > 0 ? normalizedStartedAt : null;
      }
      if (updates.currentHeroSmsRequestStartedAt !== undefined) {
        const normalizedRequestStartedAt = Math.floor(Number(updates.currentHeroSmsRequestStartedAt) || 0);
        payload.currentHeroSmsRequestStartedAt = normalizedRequestStartedAt > 0 ? normalizedRequestStartedAt : null;
      }

      if (!Object.keys(payload).length) {
        return;
      }

      await setState(payload);
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate(payload);
      }
    }

    async function executeScriptOnTab(tabId, func, args = []) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func,
        args,
      });
      return results?.[0]?.result;
    }

    async function inspectPhoneVerificationPage(tabId) {
      return executeScriptOnTab(tabId, (submitButtonSelector, phoneSelector, verificationSelector, splitVerificationSelector) => {
        function isVisibleElement(element) {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
        }

        function findVisible(selector) {
          const candidates = document.querySelectorAll(selector);
          for (const candidate of candidates) {
            if (isVisibleElement(candidate) && !candidate.disabled) {
              return candidate;
            }
          }
          return null;
        }

        function getActionText(element) {
          return [
            element?.textContent,
            element?.value,
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title'),
          ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        }

        const pageText = (document.body?.innerText || document.documentElement?.innerText || '').replace(/\s+/g, ' ').trim();
        const phoneInput = findVisible(phoneSelector);
        const verificationInput = findVisible(verificationSelector);
        const splitVerificationInputs = Array.from(document.querySelectorAll(splitVerificationSelector))
          .filter((candidate) => isVisibleElement(candidate) && !candidate.disabled);
        const submitButton = Array.from(document.querySelectorAll(submitButtonSelector)).find((candidate) => {
          if (!isVisibleElement(candidate) || candidate.disabled || candidate.getAttribute('aria-disabled') === 'true') {
            return false;
          }
          const text = getActionText(candidate);
          return /continue|verify|confirm|next|提交|继续|验证|确认/i.test(text);
        }) || findVisible('button[type="submit"], input[type="submit"]');
        const path = `${location.pathname || ''} ${location.href || ''}`;
        const addPhonePage = /\/add-phone(?:[/?#]|$)/i.test(path)
          || Boolean(phoneInput)
          || Boolean(verificationInput)
          || splitVerificationInputs.length >= 6;

        return {
          url: location.href,
          addPhonePage,
          phoneInputVisible: Boolean(phoneInput),
          verificationInputVisible: Boolean(verificationInput) || splitVerificationInputs.length >= 6,
          splitVerificationInputVisible: splitVerificationInputs.length >= 6,
          submitButtonVisible: Boolean(submitButton),
          phoneMaxUsageExceeded: /phone[_\s-]*max[_\s-]*usage[_\s-]*exceeded/i.test(pageText),
        };
      }, [
        SUBMIT_BUTTON_SELECTOR,
        PHONE_INPUT_SELECTOR,
        VERIFICATION_INPUT_SELECTOR,
        SPLIT_VERIFICATION_INPUT_SELECTOR,
      ]);
    }

    async function waitForPhoneVerificationStage(tabId, stage = 'phone_or_code', timeoutMs = 60000) {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        throwIfStopped();
        const pageState = await inspectPhoneVerificationPage(tabId);
        if (pageState?.phoneMaxUsageExceeded) {
          throw new Error(PHONE_MAX_USAGE_EXCEEDED_ERROR_CODE);
        }

        if (stage === 'phone' && pageState?.phoneInputVisible) {
          return pageState;
        }
        if (stage === 'code' && pageState?.verificationInputVisible) {
          return pageState;
        }
        if (stage === 'phone_or_code' && (pageState?.phoneInputVisible || pageState?.verificationInputVisible)) {
          return pageState;
        }
        if (stage === 'leave_add_phone' && !pageState?.addPhonePage) {
          return pageState;
        }

        await sleepWithStop(400);
      }

      if (stage === 'code') {
        throw new Error('步骤 9：等待短信验证码输入框出现超时。');
      }
      if (stage === 'phone') {
        throw new Error('步骤 9：等待手机号输入框出现超时。');
      }
      if (stage === 'leave_add_phone') {
        throw new Error('步骤 9：提交短信验证码后页面长时间未离开手机号验证页。');
      }
      throw new Error('步骤 9：等待手机号验证页面就绪超时。');
    }

    async function fillPhoneNumberAndSubmit(tabId, phoneNumber) {
      const result = await executeScriptOnTab(tabId, (selector, submitSelector, rawPhoneNumber) => {
        function isVisibleElement(element) {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
        }

        function getActionText(element) {
          return [
            element?.textContent,
            element?.value,
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title'),
          ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        }

        function findVisible(selector) {
          const candidates = document.querySelectorAll(selector);
          for (const candidate of candidates) {
            if (isVisibleElement(candidate) && !candidate.disabled) {
              return candidate;
            }
          }
          return null;
        }

        const phoneInput = findVisible(selector);
        if (!phoneInput) {
          return { ok: false, error: '未找到手机号输入框。' };
        }

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (!setter) {
          return { ok: false, error: '无法设置手机号输入框值。' };
        }

        setter.call(phoneInput, rawPhoneNumber);
        phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
        phoneInput.dispatchEvent(new Event('change', { bubbles: true }));

        const submitButton = Array.from(document.querySelectorAll(submitSelector)).find((candidate) => {
          if (!isVisibleElement(candidate) || candidate.disabled || candidate.getAttribute('aria-disabled') === 'true') {
            return false;
          }
          return /continue|next|verify|确认|继续|提交|验证/i.test(getActionText(candidate));
        }) || findVisible('button[type="submit"], input[type="submit"]');

        if (submitButton) {
          submitButton.click();
        }

        return {
          ok: true,
          clicked: Boolean(submitButton),
        };
      }, [PHONE_INPUT_SELECTOR, SUBMIT_BUTTON_SELECTOR, phoneNumber]);

      if (!result?.ok) {
        throw new Error(result?.error || '填写手机号失败。');
      }
      return result;
    }

    async function fillSmsCodeAndSubmit(tabId, code) {
      const result = await executeScriptOnTab(tabId, (selector, splitSelector, submitSelector, rawCode) => {
        function isVisibleElement(element) {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
        }

        function getActionText(element) {
          return [
            element?.textContent,
            element?.value,
            element?.getAttribute?.('aria-label'),
            element?.getAttribute?.('title'),
          ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        }

        function findVisible(selector) {
          const candidates = document.querySelectorAll(selector);
          for (const candidate of candidates) {
            if (isVisibleElement(candidate) && !candidate.disabled) {
              return candidate;
            }
          }
          return null;
        }

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (!setter) {
          return { ok: false, error: '无法设置验证码输入框值。' };
        }

        const splitInputs = Array.from(document.querySelectorAll(splitSelector))
          .filter((candidate) => isVisibleElement(candidate) && !candidate.disabled);
        if (splitInputs.length >= 6) {
          for (let index = 0; index < 6; index += 1) {
            setter.call(splitInputs[index], rawCode[index] || '');
            splitInputs[index].dispatchEvent(new Event('input', { bubbles: true }));
            splitInputs[index].dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else {
          const codeInput = findVisible(selector);
          if (!codeInput) {
            return { ok: false, error: '未找到短信验证码输入框。' };
          }
          setter.call(codeInput, rawCode);
          codeInput.dispatchEvent(new Event('input', { bubbles: true }));
          codeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const submitButton = Array.from(document.querySelectorAll(submitSelector)).find((candidate) => {
          if (!isVisibleElement(candidate) || candidate.disabled || candidate.getAttribute('aria-disabled') === 'true') {
            return false;
          }
          return /continue|next|verify|confirm|确认|继续|提交|验证/i.test(getActionText(candidate));
        }) || findVisible('button[type="submit"], input[type="submit"]');

        if (submitButton) {
          submitButton.click();
        }

        return {
          ok: true,
          clicked: Boolean(submitButton),
        };
      }, [VERIFICATION_INPUT_SELECTOR, SPLIT_VERIFICATION_INPUT_SELECTOR, SUBMIT_BUTTON_SELECTOR, code]);

      if (!result?.ok) {
        throw new Error(result?.error || '填写短信验证码失败。');
      }
      return result;
    }

    async function cleanupHeroSmsActivation(options = {}) {
      const {
        state: providedState = null,
        finish = false,
        logFailure = false,
        logSuccess = false,
      } = options;
      const latestState = providedState || await getState();
      const activationId = String(latestState?.currentHeroSmsActivationId || '').trim();
      const phoneNumber = String(latestState?.currentHeroSmsPhoneNumber || '').trim();
      const apiKey = String(latestState?.heroSmsApiKey || '').trim();
      const activationStartedAt = Math.floor(Number(latestState?.currentHeroSmsActivationStartedAt) || 0);
      const requestStartedAt = Math.floor(Number(latestState?.currentHeroSmsRequestStartedAt) || 0);

      let finished = false;
      if (finish && apiKey && activationId) {
        try {
          await heroFinishSmsActivation(apiKey, activationId);
          finished = true;
          if (logSuccess) {
            await addLog(`已调用 Hero-SMS 完成激活（ID: ${activationId}）。`, 'info');
          }
        } catch (error) {
          if (logFailure) {
            await addLog(`调用 Hero-SMS 完成激活失败：${getErrorMessage(error)}`, 'warn');
          }
        }
      }

      if (activationId || phoneNumber || activationStartedAt || requestStartedAt) {
        await setHeroSmsRuntimeState({
          currentHeroSmsActivationId: null,
          currentHeroSmsPhoneNumber: null,
          currentHeroSmsActivationStartedAt: null,
          currentHeroSmsRequestStartedAt: null,
        });
      }

      return {
        finished,
        cleared: Boolean(activationId || phoneNumber || activationStartedAt || requestStartedAt),
      };
    }

    async function handlePhoneMaxUsageExceededFlow(state = null) {
      const latestState = state || await getState();
      await addLog('步骤 9：检测到 phone_max_usage_exceeded，当前流程将放弃本轮并直接进入下一轮。', 'warn');

      if (latestState.currentHotmailAccountId && isHotmailProvider(latestState)) {
        await patchHotmailAccount(latestState.currentHotmailAccountId, {
          used: true,
          lastUsedAt: Date.now(),
        });
        await addLog('当前 Hotmail 账号已自动标记为已用。', 'ok');
      }

      if (isLuckmailProvider(latestState)) {
        const currentPurchase = getCurrentLuckmailPurchase(latestState);
        if (currentPurchase?.id) {
          await setLuckmailPurchaseUsedState(currentPurchase.id, true);
          await addLog(`当前 LuckMail 邮箱 ${currentPurchase.email_address} 已在本地标记为已用。`, 'ok');
        }
        await clearLuckmailRuntimeState({ clearEmail: true });
      }

      await cleanupHeroSmsActivation({
        state: latestState,
        finish: true,
        logFailure: true,
        logSuccess: true,
      });
    }

    async function ensurePhoneVerificationIfNeeded(state, tabId, options = {}) {
      const currentState = state || await getState();
      if (!Number.isInteger(tabId)) {
        throw new Error('步骤 9：缺少有效的认证页标签页，无法执行手机号验证。');
      }

      let pageState = await inspectPhoneVerificationPage(tabId);
      if (!pageState?.addPhonePage) {
        return { handled: false, reason: 'not_needed', pageState };
      }

      if (pageState.phoneMaxUsageExceeded) {
        throw new Error(PHONE_MAX_USAGE_EXCEEDED_ERROR_CODE);
      }

      if (!currentState.heroSmsEnabled) {
        throw new Error('步骤 9：认证页进入了手机号页面，当前不是 OAuth 同意页，无法继续自动授权。');
      }
      if (!currentState.heroSmsApiKey) {
        throw new Error('步骤 9：已启用 Hero-SMS，但未填写 SMS-APIKey。');
      }
      if (!currentState.heroSmsCountry) {
        throw new Error('步骤 9：已启用 Hero-SMS，但未填写 SMS-国家。');
      }

      await addLog('步骤 9：检测到手机号验证页面，正在通过 Hero-SMS 获取手机号...', 'info');

      let activationId = String(currentState.currentHeroSmsActivationId || '').trim();
      let phoneNumber = String(currentState.currentHeroSmsPhoneNumber || '').trim();
      let activationStartedAt = Math.floor(Number(currentState.currentHeroSmsActivationStartedAt) || 0);
      let smsRequestStartedAt = Math.floor(Number(currentState.currentHeroSmsRequestStartedAt) || 0);

      async function ensureActivationReady() {
        if (!activationId || !phoneNumber) {
          const activation = await heroFindOrCreateSmsActivation(currentState.heroSmsApiKey, currentState.heroSmsCountry);
          activationId = String(activation?.activationId || '').trim();
          phoneNumber = String(activation?.phoneNumber || '').trim();
          activationStartedAt = Date.now();
          smsRequestStartedAt = 0;
          if (!activationId || !phoneNumber) {
            throw new Error('步骤 9：Hero-SMS 未返回可用的手机号激活信息。');
          }

          await setHeroSmsRuntimeState({
            currentHeroSmsActivationId: activationId,
            currentHeroSmsPhoneNumber: phoneNumber,
            currentHeroSmsActivationStartedAt: activationStartedAt,
            currentHeroSmsRequestStartedAt: null,
          });
          await addLog(`步骤 9：已获取手机号 ${normalizeOpenAiPhoneNumber(phoneNumber)}（激活ID: ${activationId}）。`, 'info');
          return;
        }

        if (!activationStartedAt) {
          activationStartedAt = Date.now();
          await setHeroSmsRuntimeState({
            currentHeroSmsActivationStartedAt: activationStartedAt,
          });
        }

        await addLog(`步骤 9：复用当前 Hero-SMS 激活手机号 ${normalizeOpenAiPhoneNumber(phoneNumber)}。`, 'info');
      }

      async function prepareHeroSmsRequestForPageSend() {
        if (typeof heroPrepareActivationForSmsRequest !== 'function') {
          return null;
        }

        const prepareResult = await heroPrepareActivationForSmsRequest(
          currentState.heroSmsApiKey,
          activationId,
          phoneNumber
        );

        if (prepareResult?.requestMode === 'retry') {
          await addLog(
            `步骤 9：当前号码历史已接过 ${prepareResult.receivedCodeCount} 次验证码，已通知 Hero-SMS 进入等待新短信状态。`,
            'info'
          );
        }

        return prepareResult;
      }

      async function submitPhoneNumberAndStartSmsTimer() {
        await ensureActivationReady();
        await prepareHeroSmsRequestForPageSend();
        await fillPhoneNumberAndSubmit(tabId, normalizeOpenAiPhoneNumber(phoneNumber));
        smsRequestStartedAt = Date.now();
        await setHeroSmsRuntimeState({
          currentHeroSmsRequestStartedAt: smsRequestStartedAt,
        });
        await addLog(`步骤 9：已填入手机号 ${normalizeOpenAiPhoneNumber(phoneNumber)}，正在等待短信验证码输入框...`, 'info');
        pageState = await waitForPhoneVerificationStage(tabId, 'code', options.codeStageTimeoutMs || 60000);
      }

      if (pageState.phoneInputVisible) {
        await submitPhoneNumberAndStartSmsTimer();
      } else if (!pageState.verificationInputVisible) {
        pageState = await waitForPhoneVerificationStage(tabId, 'phone_or_code', options.pageReadyTimeoutMs || 60000);
        if (pageState?.phoneInputVisible) {
          await submitPhoneNumberAndStartSmsTimer();
        }
      }

      if (!activationId || !phoneNumber || !smsRequestStartedAt) {
        const latestState = await getState();
        activationId = String(latestState.currentHeroSmsActivationId || activationId || '').trim();
        phoneNumber = String(latestState.currentHeroSmsPhoneNumber || phoneNumber || '').trim();
        activationStartedAt = Math.floor(Number(latestState.currentHeroSmsActivationStartedAt) || activationStartedAt || 0);
        smsRequestStartedAt = Math.floor(Number(latestState.currentHeroSmsRequestStartedAt) || smsRequestStartedAt || 0);
      }
      if (!activationId || !phoneNumber) {
        throw new Error('步骤 9：当前短信验证页缺少有效的 Hero-SMS 激活信息，请重新开始本轮。');
      }
      if (!activationStartedAt) {
        activationStartedAt = Date.now();
        await setHeroSmsRuntimeState({
          currentHeroSmsActivationStartedAt: activationStartedAt,
        });
      }
      if (!smsRequestStartedAt) {
        smsRequestStartedAt = Date.now();
        await setHeroSmsRuntimeState({
          currentHeroSmsRequestStartedAt: smsRequestStartedAt,
        });
      }

      let verificationCode = '';
      try {
        verificationCode = await heroPollSmsVerificationCode(
          currentState.heroSmsApiKey,
          activationId,
          async (step, message, level = 'info') => {
            await addLog(`步骤 ${step}：${message}`, level);
          },
          9,
          async () => {
            throwIfStopped();
            const currentPageState = await inspectPhoneVerificationPage(tabId).catch(() => null);
            if (currentPageState?.phoneMaxUsageExceeded) {
              throw new Error(PHONE_MAX_USAGE_EXCEEDED_ERROR_CODE);
            }
          },
          {
            initialPhoneNumber: phoneNumber,
            smsRequestStartedAt,
          }
        );
      } catch (error) {
        if (isHeroSmsFirstCodeTimeoutError(error)) {
          await cleanupHeroSmsActivation({
            state: {
              heroSmsApiKey: currentState.heroSmsApiKey,
              currentHeroSmsActivationId: activationId,
              currentHeroSmsPhoneNumber: phoneNumber,
              currentHeroSmsActivationStartedAt: activationStartedAt,
              currentHeroSmsRequestStartedAt: smsRequestStartedAt,
            },
            logFailure: true,
          }).catch(() => { });
        }
        throw error;
      }

      await addLog(`步骤 9：已获取短信验证码：${verificationCode}，正在填入页面...`, 'ok');
      await fillSmsCodeAndSubmit(tabId, verificationCode);
      await addLog('步骤 9：已提交短信验证码，准备继续后续授权流程。', 'info');

      await sleepWithStop(1500);
      pageState = await inspectPhoneVerificationPage(tabId).catch(() => null);
      if (pageState?.phoneMaxUsageExceeded) {
        throw new Error(PHONE_MAX_USAGE_EXCEEDED_ERROR_CODE);
      }

      return {
        handled: true,
        activationId,
        phoneNumber,
        pageState,
      };
    }

    return {
      HERO_SMS_FIRST_CODE_TIMEOUT_ERROR_CODE,
      HERO_SMS_NEXT_CODE_TIMEOUT_ERROR_CODE,
      PHONE_MAX_USAGE_EXCEEDED_ERROR_CODE,
      cleanupHeroSmsActivation,
      ensurePhoneVerificationIfNeeded,
      fillPhoneNumberAndSubmit,
      fillSmsCodeAndSubmit,
      handlePhoneMaxUsageExceededFlow,
      inspectPhoneVerificationPage,
      isHeroSmsFirstCodeTimeoutError,
      isPhoneMaxUsageExceededError,
      normalizeOpenAiPhoneNumber,
      waitForPhoneVerificationStage,
    };
  }

  return {
    createPhoneVerificationHelpers,
  };
});
