(function heroSmsUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.HeroSmsUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createHeroSmsUtils() {
  const HERO_SMS_BASE_URL = 'https://hero-sms.com/stubs/handler_api.php';
  const HERO_SMS_PHONE_RECORDS_STORAGE_KEY = 'heroSmsPhoneRecords';
  const HERO_SMS_BLOCKED_PHONE_RECORDS_STORAGE_KEY = 'heroSmsBlockedPhoneRecords';
  const HERO_SMS_EXHAUSTED_PHONE_RECORDS_STORAGE_KEY = 'heroSmsExhaustedPhoneRecords';
  const HERO_SMS_BLOCKED_PHONE_DURATION_MS = 6 * 60 * 60 * 1000;
  const HERO_SMS_MAX_RECEIVED_CODE_COUNT = 3;
  const HERO_SMS_MAX_GET_NUMBER_ATTEMPTS = 5;
  const HERO_SMS_FIRST_CODE_TIMEOUT_MS = 120_000;
  const HERO_SMS_NEXT_CODE_TIMEOUT_MS = 180_000;
  const HERO_SMS_FIRST_CODE_TIMEOUT_ERROR_CODE = 'HERO_SMS_FIRST_CODE_TIMEOUT::no_first_sms_in_120s';
  const HERO_SMS_NEXT_CODE_TIMEOUT_ERROR_CODE = 'HERO_SMS_NEXT_CODE_TIMEOUT::no_next_sms_in_180s';
  const HERO_SMS_REQUEST_NEXT_CODE_STATUS = 3;

  async function heroSmsRequest(params, apiKey) {
    const url = new URL(HERO_SMS_BASE_URL);
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
    url.searchParams.set('api_key', String(apiKey || '').trim());

    const response = await fetch(url.toString());
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  async function getActiveActivations(apiKey) {
    return heroSmsRequest({ action: 'getActiveActivations' }, apiKey);
  }

  async function getNumberV2(apiKey, country) {
    return heroSmsRequest({ action: 'getNumberV2', service: 'dr', country }, apiKey);
  }

  async function getStatusV2(apiKey, activationId) {
    return heroSmsRequest({ action: 'getStatusV2', id: activationId }, apiKey);
  }

  async function setHeroSmsStatus(apiKey, activationId, status) {
    return heroSmsRequest({ action: 'setStatus', id: activationId, status }, apiKey);
  }

  async function finishActivation(apiKey, activationId) {
    return heroSmsRequest({ action: 'finishActivation', id: activationId }, apiKey);
  }

  async function cancelActivation(apiKey, activationId) {
    const result = await setHeroSmsStatus(apiKey, activationId, 8);
    const normalizedText = String(result || '').trim().toUpperCase();
    const normalizedTitle = String(result?.title || result?.status || '').trim().toUpperCase();
    if (normalizedText === 'ACCESS_CANCEL' || normalizedTitle === 'CANCELED') {
      return result;
    }

    const details = String(result?.details || result?.message || '').trim();
    const title = String(result?.title || '').trim();
    throw new Error(details || title || normalizedText || '取消 Hero-SMS activation 失败。');
  }

  function normalizeHeroSmsResponseText(result) {
    if (typeof result === 'string') {
      return result.trim();
    }
    if (typeof result?.status === 'string' && result.status.trim()) {
      return result.status.trim();
    }
    if (typeof result?.title === 'string' && result.title.trim()) {
      return result.title.trim();
    }
    if (typeof result?.message === 'string' && result.message.trim()) {
      return result.message.trim();
    }
    if (typeof result?.details === 'string' && result.details.trim()) {
      return result.details.trim();
    }
    return '';
  }

  function normalizeHeroSmsActivationStatus(result) {
    const rawText = normalizeHeroSmsResponseText(result);
    const upperText = rawText.toUpperCase();
    return {
      raw: result,
      text: rawText,
      upperText,
      token: upperText.split(/[\s:]+/)[0] || '',
    };
  }

  function isHeroSmsExplicitErrorResult(result) {
    const { upperText, token } = normalizeHeroSmsActivationStatus(result);
    if (!upperText) {
      return false;
    }
    return token === 'ERROR'
      || token === 'BAD_ACTION'
      || token === 'BAD_STATUS'
      || token === 'NO_ACTIVATION'
      || token === 'STATUS_CANCEL'
      || token === 'ACCESS_CANCEL'
      || token === 'CANCELED'
      || token === 'STATUS_FINISH'
      || token === 'STATUS_FINISHED'
      || token === 'FULL_SMS'
      || token === 'NO_NUMBERS';
  }

  function normalizePhoneRecordKey(phoneNumber) {
    return String(phoneNumber || '').trim().replace(/^\+/, '');
  }

  function normalizeCodeValue(code) {
    return String(code || '').trim();
  }

  function normalizeBlockedUntilValue(value) {
    const normalized = Math.floor(Number(value) || 0);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
  }

  function normalizeReceivedCodeCountValue(value) {
    const normalized = Math.floor(Number(value) || 0);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0;
    }
    return Math.min(HERO_SMS_MAX_RECEIVED_CODE_COUNT, normalized);
  }

  function normalizeExhaustedRecordValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const exhaustedAt = Math.floor(Number(
      value.exhaustedAt
      ?? value.createdAt
      ?? value.timestamp
      ?? 0
    ) || 0);
    const reason = String(value.reason || '').trim();
    const receivedCodeCount = normalizeReceivedCodeCountValue(
      value.receivedCodeCount
      ?? value.codeCount
      ?? value.codesLength
    );

    if (exhaustedAt <= 0) {
      return null;
    }

    return {
      exhaustedAt,
      reason,
      receivedCodeCount,
    };
  }

  async function getHeroSmsPhoneRecords() {
    if (!globalThis.chrome?.storage?.local) {
      return {};
    }
    const stored = await globalThis.chrome.storage.local.get(HERO_SMS_PHONE_RECORDS_STORAGE_KEY);
    const value = stored?.[HERO_SMS_PHONE_RECORDS_STORAGE_KEY];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  async function setHeroSmsPhoneRecords(records) {
    if (!globalThis.chrome?.storage?.local) {
      return;
    }
    await globalThis.chrome.storage.local.set({
      [HERO_SMS_PHONE_RECORDS_STORAGE_KEY]: records,
    });
  }

  async function getHeroSmsBlockedPhoneRecords(now = Date.now()) {
    if (!globalThis.chrome?.storage?.local) {
      return {};
    }

    const stored = await globalThis.chrome.storage.local.get(HERO_SMS_BLOCKED_PHONE_RECORDS_STORAGE_KEY);
    const rawRecords = stored?.[HERO_SMS_BLOCKED_PHONE_RECORDS_STORAGE_KEY];
    const records = rawRecords && typeof rawRecords === 'object' && !Array.isArray(rawRecords) ? rawRecords : {};
    const normalized = {};

    for (const [phoneKey, blockedUntil] of Object.entries(records)) {
      const normalizedPhoneKey = normalizePhoneRecordKey(phoneKey);
      const normalizedBlockedUntil = normalizeBlockedUntilValue(blockedUntil);
      if (normalizedPhoneKey && normalizedBlockedUntil > now) {
        normalized[normalizedPhoneKey] = normalizedBlockedUntil;
      }
    }

    if (JSON.stringify(records) !== JSON.stringify(normalized)) {
      await globalThis.chrome.storage.local.set({
        [HERO_SMS_BLOCKED_PHONE_RECORDS_STORAGE_KEY]: normalized,
      });
    }

    return normalized;
  }

  async function setHeroSmsBlockedPhoneRecords(records) {
    if (!globalThis.chrome?.storage?.local) {
      return;
    }

    await globalThis.chrome.storage.local.set({
      [HERO_SMS_BLOCKED_PHONE_RECORDS_STORAGE_KEY]: records && typeof records === 'object' && !Array.isArray(records)
        ? records
        : {},
    });
  }

  async function getHeroSmsExhaustedPhoneRecords() {
    if (!globalThis.chrome?.storage?.local) {
      return {};
    }

    const stored = await globalThis.chrome.storage.local.get(HERO_SMS_EXHAUSTED_PHONE_RECORDS_STORAGE_KEY);
    const rawRecords = stored?.[HERO_SMS_EXHAUSTED_PHONE_RECORDS_STORAGE_KEY];
    const records = rawRecords && typeof rawRecords === 'object' && !Array.isArray(rawRecords) ? rawRecords : {};
    const normalized = {};

    for (const [phoneKey, record] of Object.entries(records)) {
      const normalizedPhoneKey = normalizePhoneRecordKey(phoneKey);
      const normalizedRecord = normalizeExhaustedRecordValue(record);
      if (normalizedPhoneKey && normalizedRecord) {
        normalized[normalizedPhoneKey] = normalizedRecord;
      }
    }

    if (JSON.stringify(records) !== JSON.stringify(normalized)) {
      await globalThis.chrome.storage.local.set({
        [HERO_SMS_EXHAUSTED_PHONE_RECORDS_STORAGE_KEY]: normalized,
      });
    }

    return normalized;
  }

  async function setHeroSmsExhaustedPhoneRecords(records) {
    if (!globalThis.chrome?.storage?.local) {
      return;
    }

    const normalized = {};
    const inputRecords = records && typeof records === 'object' && !Array.isArray(records)
      ? records
      : {};

    for (const [phoneKey, record] of Object.entries(inputRecords)) {
      const normalizedPhoneKey = normalizePhoneRecordKey(phoneKey);
      const normalizedRecord = normalizeExhaustedRecordValue(record);
      if (normalizedPhoneKey && normalizedRecord) {
        normalized[normalizedPhoneKey] = normalizedRecord;
      }
    }

    await globalThis.chrome.storage.local.set({
      [HERO_SMS_EXHAUSTED_PHONE_RECORDS_STORAGE_KEY]: normalized,
    });
  }

  async function markPhoneNumberBlocked(phoneNumber, options = {}) {
    const phoneKey = normalizePhoneRecordKey(phoneNumber);
    if (!phoneKey) {
      return { phoneKey: '', blockedUntil: 0 };
    }

    const durationMs = Math.max(0, Math.floor(Number(options.durationMs) || HERO_SMS_BLOCKED_PHONE_DURATION_MS));
    const now = Math.floor(Number(options.now) || Date.now());
    const blockedUntil = now + durationMs;
    const records = await getHeroSmsBlockedPhoneRecords(now);
    records[phoneKey] = blockedUntil;
    await setHeroSmsBlockedPhoneRecords(records);
    return { phoneKey, blockedUntil };
  }

  async function isPhoneNumberBlocked(phoneNumber, now = Date.now()) {
    const phoneKey = normalizePhoneRecordKey(phoneNumber);
    if (!phoneKey) {
      return false;
    }

    const records = await getHeroSmsBlockedPhoneRecords(now);
    return normalizeBlockedUntilValue(records[phoneKey]) > now;
  }

  async function markPhoneNumberExhausted(phoneNumber, options = {}) {
    const phoneKey = normalizePhoneRecordKey(phoneNumber);
    if (!phoneKey) {
      return { phoneKey: '', record: null };
    }

    const exhaustedAt = Math.max(1, Math.floor(Number(options.exhaustedAt ?? options.now) || Date.now()));
    const record = {
      exhaustedAt,
      reason: String(options.reason || '').trim(),
      receivedCodeCount: normalizeReceivedCodeCountValue(options.receivedCodeCount),
    };

    const records = await getHeroSmsExhaustedPhoneRecords();
    records[phoneKey] = record;
    await setHeroSmsExhaustedPhoneRecords(records);
    return {
      phoneKey,
      record,
    };
  }

  async function isPhoneNumberExhausted(phoneNumber) {
    const phoneKey = normalizePhoneRecordKey(phoneNumber);
    if (!phoneKey) {
      return false;
    }

    const records = await getHeroSmsExhaustedPhoneRecords();
    return Boolean(records[phoneKey]);
  }

  function createHeroSmsFirstCodeTimeoutError(phoneNumber = '', timeoutMs = HERO_SMS_FIRST_CODE_TIMEOUT_MS) {
    const timeoutSeconds = Math.ceil(Math.max(0, Number(timeoutMs) || HERO_SMS_FIRST_CODE_TIMEOUT_MS) / 1000);
    const normalizedPhoneNumber = String(phoneNumber || '').trim();
    const phoneMessage = normalizedPhoneNumber
      ? `（手机号 ${normalizedPhoneNumber} 在 ${timeoutSeconds} 秒内未收到任何验证码）`
      : `（在 ${timeoutSeconds} 秒内未收到任何验证码）`;
    return new Error(`${HERO_SMS_FIRST_CODE_TIMEOUT_ERROR_CODE}${phoneMessage}`);
  }

  function createHeroSmsNextCodeTimeoutError(phoneNumber = '', timeoutMs = HERO_SMS_NEXT_CODE_TIMEOUT_MS, receivedCodeCount = 1) {
    const timeoutSeconds = Math.ceil(Math.max(0, Number(timeoutMs) || HERO_SMS_NEXT_CODE_TIMEOUT_MS) / 1000);
    const normalizedPhoneNumber = String(phoneNumber || '').trim();
    const normalizedCount = Math.max(1, normalizeReceivedCodeCountValue(receivedCodeCount) || 1);
    const phoneMessage = normalizedPhoneNumber
      ? `（手机号 ${normalizedPhoneNumber} 历史已收到 ${normalizedCount} 次验证码，本次在 ${timeoutSeconds} 秒内未收到新的验证码）`
      : `（历史已收到 ${normalizedCount} 次验证码，本次在 ${timeoutSeconds} 秒内未收到新的验证码）`;
    return new Error(`${HERO_SMS_NEXT_CODE_TIMEOUT_ERROR_CODE}${phoneMessage}`);
  }

  function getPhoneCodesFromRecords(records, phoneNumber) {
    const key = normalizePhoneRecordKey(phoneNumber);
    const value = records?.[key];
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map(normalizeCodeValue)
      .filter(Boolean)
      .slice(0, HERO_SMS_MAX_RECEIVED_CODE_COUNT);
  }

  async function ensurePhoneRecord(phoneNumber) {
    const key = normalizePhoneRecordKey(phoneNumber);
    if (!key) {
      return [];
    }

    const records = await getHeroSmsPhoneRecords();
    const existingCodes = getPhoneCodesFromRecords(records, key);
    if (!Array.isArray(records[key])) {
      records[key] = existingCodes;
      await setHeroSmsPhoneRecords(records);
    }
    return existingCodes;
  }

  async function getPhoneRecordStatus(phoneNumber) {
    const key = normalizePhoneRecordKey(phoneNumber);
    const [records, exhaustedRecords] = await Promise.all([
      getHeroSmsPhoneRecords(),
      getHeroSmsExhaustedPhoneRecords(),
    ]);
    const codes = getPhoneCodesFromRecords(records, phoneNumber);
    const exhaustedRecord = key ? exhaustedRecords[key] || null : null;
    const exhausted = codes.length >= HERO_SMS_MAX_RECEIVED_CODE_COUNT || Boolean(exhaustedRecord);
    return {
      key,
      codes,
      usable: !exhausted,
      exhausted,
      localExhausted: Boolean(exhaustedRecord),
      exhaustedRecord,
    };
  }

  function resolveCodeTimeoutPolicyByCodeCount(receivedCodeCount = 0, options = {}) {
    const normalizedCount = normalizeReceivedCodeCountValue(receivedCodeCount);
    const firstCodeTimeoutMs = Math.max(1, Math.floor(Number(options.firstCodeTimeoutMs) || HERO_SMS_FIRST_CODE_TIMEOUT_MS));
    const nextCodeTimeoutMs = Math.max(1, Math.floor(Number(options.nextCodeTimeoutMs) || HERO_SMS_NEXT_CODE_TIMEOUT_MS));
    if (normalizedCount >= HERO_SMS_MAX_RECEIVED_CODE_COUNT) {
      return {
        exhausted: true,
        receivedCodeCount: normalizedCount,
        timeoutMs: 0,
        timeoutType: 'exhausted',
        timeoutErrorCode: '',
      };
    }

    if (normalizedCount > 0) {
      return {
        exhausted: false,
        receivedCodeCount: normalizedCount,
        timeoutMs: nextCodeTimeoutMs,
        timeoutType: 'next',
        timeoutErrorCode: HERO_SMS_NEXT_CODE_TIMEOUT_ERROR_CODE,
      };
    }

    return {
      exhausted: false,
      receivedCodeCount: 0,
      timeoutMs: firstCodeTimeoutMs,
      timeoutType: 'first',
      timeoutErrorCode: HERO_SMS_FIRST_CODE_TIMEOUT_ERROR_CODE,
    };
  }

  function getPhoneReuseDecision(phoneNumber, records, blockedPhoneRecords, exhaustedPhoneRecords, now = Date.now()) {
    const phoneKey = normalizePhoneRecordKey(phoneNumber);
    const receivedCodeCount = getPhoneCodesFromRecords(records, phoneKey).length;
    const blocked = normalizeBlockedUntilValue(blockedPhoneRecords?.[phoneKey]) > now;
    const exhausted = Boolean(exhaustedPhoneRecords?.[phoneKey])
      || receivedCodeCount >= HERO_SMS_MAX_RECEIVED_CODE_COUNT;

    return {
      phoneKey,
      receivedCodeCount,
      blocked,
      exhausted,
      usable: Boolean(phoneKey) && !blocked && !exhausted,
    };
  }

  async function findOrCreateSmsActivation(apiKey, targetCountry) {
    const result = await getActiveActivations(apiKey);
    if (!result || result.status !== 'success' || !Array.isArray(result.data)) {
      throw new Error('获取短信激活列表失败');
    }

    const [records, blockedPhoneRecords, exhaustedPhoneRecords] = await Promise.all([
      getHeroSmsPhoneRecords(),
      getHeroSmsBlockedPhoneRecords(),
      getHeroSmsExhaustedPhoneRecords(),
    ]);
    const now = Date.now();
    const candidates = result.data
      .filter((item) => {
        const countryMatches = String(item.countryCode || '') === String(targetCountry || '');
        const serviceCode = String(item.serviceCode || item.service || '').trim().toLowerCase();
        const serviceMatches = !serviceCode || serviceCode === 'dr';
        const reuseDecision = getPhoneReuseDecision(
          item.phoneNumber,
          records,
          blockedPhoneRecords,
          exhaustedPhoneRecords,
          now
        );
        return countryMatches && serviceMatches && reuseDecision.usable;
      })
      .sort((left, right) => new Date(right.activationTime || 0) - new Date(left.activationTime || 0));

    const chosen = candidates[0] || null;
    if (chosen) {
      await ensurePhoneRecord(chosen.phoneNumber);
      return {
        activationId: chosen.activationId,
        phoneNumber: chosen.phoneNumber,
      };
    }

    for (let attempt = 1; attempt <= HERO_SMS_MAX_GET_NUMBER_ATTEMPTS; attempt += 1) {
      const nextActivation = await getNumberV2(apiKey, targetCountry);
      if (!nextActivation || !nextActivation.activationId) {
        throw new Error('获取新的短信号码失败');
      }

      const nextPhoneNumber = String(nextActivation.phoneNumber || '').trim();
      const reuseDecision = getPhoneReuseDecision(
        nextPhoneNumber,
        records,
        blockedPhoneRecords,
        exhaustedPhoneRecords,
        Date.now()
      );

      if (reuseDecision.usable) {
        await ensurePhoneRecord(nextPhoneNumber);
        return {
          activationId: nextActivation.activationId,
          phoneNumber: nextPhoneNumber,
        };
      }

      await cancelActivation(apiKey, nextActivation.activationId).catch(() => null);
    }

    throw new Error('Hero-SMS 连续返回本地不可复用的手机号，请稍后重试。');
  }

  async function prepareActivationForSmsRequest(apiKey, activationId, phoneNumber, options = {}) {
    const normalizedActivationId = String(activationId || '').trim();
    const normalizedPhoneNumber = String(phoneNumber || '').trim();
    if (!apiKey || !normalizedActivationId || !normalizedPhoneNumber) {
      throw new Error('Hero-SMS 缺少 activationId 或手机号，无法准备短信请求状态。');
    }

    const phoneStatus = await getPhoneRecordStatus(normalizedPhoneNumber);
    if (phoneStatus.localExhausted || !phoneStatus.usable) {
      throw new Error(`手机号 ${normalizedPhoneNumber} 已在本地标记为耗尽，请重新获取新手机号。`);
    }

    const currentStatusResult = await getStatusV2(apiKey, normalizedActivationId).catch(() => null);
    const currentStatus = normalizeHeroSmsActivationStatus(currentStatusResult);
    if (isHeroSmsExplicitErrorResult(currentStatusResult)) {
      throw new Error(
        `Hero-SMS 当前 activation 状态异常：${currentStatus.text || 'unknown'}`
      );
    }

    if (phoneStatus.codes.length <= 0) {
      return {
        requestMode: 'first',
        receivedCodeCount: 0,
        currentStatus,
        statusSwitchResult: null,
      };
    }

    const switchResult = await setHeroSmsStatus(apiKey, normalizedActivationId, HERO_SMS_REQUEST_NEXT_CODE_STATUS);
    const normalizedSwitchResult = normalizeHeroSmsActivationStatus(switchResult);
    if (isHeroSmsExplicitErrorResult(switchResult)) {
      throw new Error(
        `Hero-SMS 切换到等待新短信状态失败：${normalizedSwitchResult.text || 'unknown'}`
      );
    }

    return {
      requestMode: 'retry',
      receivedCodeCount: phoneStatus.codes.length,
      currentStatus,
      statusSwitchResult: normalizedSwitchResult,
    };
  }

  async function sleepWithStopCheck(totalMs, stopCheck, chunkMs = 1000) {
    let remaining = Math.max(0, Number(totalMs) || 0);
    while (remaining > 0) {
      if (typeof stopCheck === 'function') {
        await stopCheck();
      }
      const waitMs = Math.min(chunkMs, remaining);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      remaining -= waitMs;
    }
  }

  async function pollSmsVerificationCode(apiKey, activationId, onLog, step, stopCheck, options = {}) {
    const resolvedOptions = options && typeof options === 'object' ? options : {};
    const POLL_INTERVAL_MS = Math.max(1, Math.floor(Number(resolvedOptions.pollIntervalMs) || 10_000));
    const MAX_DURATION_MS = Math.max(POLL_INTERVAL_MS, Math.floor(Number(resolvedOptions.maxDurationMs) || 300_000));
    let trackedPhoneNumber = String(resolvedOptions.initialPhoneNumber || '').trim();
    const startedAt = Math.floor(
      Number(resolvedOptions.smsRequestStartedAt)
      || Number(resolvedOptions.firstCodeTimeoutStartedAt)
      || 0
    ) || Date.now();

    while (Date.now() - startedAt < MAX_DURATION_MS) {
      if (typeof stopCheck === 'function') {
        await stopCheck();
      }

      let timeoutPolicy = resolveCodeTimeoutPolicyByCodeCount(0, resolvedOptions);
      if (trackedPhoneNumber) {
        const trackedStatus = await getPhoneRecordStatus(trackedPhoneNumber);
        timeoutPolicy = resolveCodeTimeoutPolicyByCodeCount(trackedStatus.codes.length, resolvedOptions);
        if (trackedStatus.localExhausted) {
          throw new Error(`手机号 ${trackedPhoneNumber} 已在本地标记为耗尽，请重新获取新手机号。`);
        }
        if (timeoutPolicy.exhausted) {
          throw new Error(`手机号 ${trackedPhoneNumber} 接码已达上限，请重新获取新手机号。`);
        }
      }

      const result = await getActiveActivations(apiKey);
      if (result && result.status === 'success' && Array.isArray(result.data)) {
        const current = result.data.find((item) => String(item.activationId) === String(activationId));
        const phoneNumber = String(current?.phoneNumber || trackedPhoneNumber || '').trim();
        const smsCode = normalizeCodeValue(current?.smsCode);
        if (phoneNumber) {
          trackedPhoneNumber = phoneNumber;
          const trackedStatus = await getPhoneRecordStatus(phoneNumber);
          timeoutPolicy = resolveCodeTimeoutPolicyByCodeCount(trackedStatus.codes.length, resolvedOptions);
          if (trackedStatus.localExhausted) {
            throw new Error(`手机号 ${phoneNumber} 已在本地标记为耗尽，请重新获取新手机号。`);
          }
          if (timeoutPolicy.exhausted) {
            throw new Error(`手机号 ${phoneNumber} 接码已达上限，请重新获取新手机号。`);
          }
        }

        if (phoneNumber && smsCode) {
          const appendResult = await appendPhoneCodeIfNew(phoneNumber, smsCode);
          if (appendResult.duplicate) {
            if (typeof onLog === 'function') {
              await onLog(step, `检测到旧验证码：${smsCode}，继续轮询新验证码...`, 'warn');
            }
          } else if (appendResult.added) {
            if (appendResult.exhausted) {
              try {
                await finishActivation(apiKey, activationId);
                if (typeof onLog === 'function') {
                  await onLog(step, `当前手机号 ${phoneNumber} 已达到 3 次接码上限，已完成该 activation。`, 'info');
                }
              } catch (error) {
                if (typeof onLog === 'function') {
                  const errorMessage = String(error?.message || error || '完成 activation 失败');
                  await onLog(step, `当前手机号 ${phoneNumber} 已达到 3 次接码上限，但完成 activation 失败：${errorMessage}`, 'warn');
                }
              }
            }
            if (typeof onLog === 'function') {
              await onLog(step, `已获取短信验证码：${smsCode}`, 'ok');
            }
            return smsCode;
          } else if (appendResult.exhausted) {
            throw new Error(`手机号 ${phoneNumber} 接码已达上限，请重新获取新手机号。`);
          }
        }
      }

      const elapsedMs = Date.now() - startedAt;
      const timeoutMs = Math.min(MAX_DURATION_MS, Math.max(1, timeoutPolicy.timeoutMs || HERO_SMS_FIRST_CODE_TIMEOUT_MS));
      if (elapsedMs >= timeoutMs) {
        if (trackedPhoneNumber) {
          await markPhoneNumberExhausted(trackedPhoneNumber, {
            reason: timeoutPolicy.timeoutType === 'next' ? 'next_code_timeout' : 'first_code_timeout',
            receivedCodeCount: timeoutPolicy.receivedCodeCount,
          }).catch(() => null);
        }

        if (typeof onLog === 'function') {
          const timeoutSeconds = Math.ceil(timeoutMs / 1000);
          const waitingMessage = timeoutPolicy.timeoutType === 'next'
            ? `当前手机号 ${trackedPhoneNumber || 'unknown'} 自本次发码起在 ${timeoutSeconds} 秒内未收到新的验证码，正在放弃该号码并重新申请新号码...`
            : `当前手机号 ${trackedPhoneNumber || 'unknown'} 自本次发码起在 ${timeoutSeconds} 秒内未收到任何验证码，正在放弃该号码并重新申请新号码...`;
          await onLog(step, waitingMessage, 'warn');
        }

        try {
          await cancelActivation(apiKey, activationId);
          if (typeof onLog === 'function') {
            await onLog(step, `已取消当前 Hero-SMS activation（ID: ${activationId}），下次将重新申请新号码。`, 'info');
          }
        } catch (error) {
          if (typeof onLog === 'function') {
            const errorMessage = String(error?.message || error || '取消 activation 失败');
            await onLog(step, `当前 Hero-SMS activation 取消失败：${errorMessage}，本次 attempt 仍将放弃该号码。`, 'warn');
          }
        }

        if (timeoutPolicy.timeoutType === 'next') {
          throw createHeroSmsNextCodeTimeoutError(trackedPhoneNumber, timeoutMs, timeoutPolicy.receivedCodeCount);
        }
        throw createHeroSmsFirstCodeTimeoutError(trackedPhoneNumber, timeoutMs);
      }

      if (typeof onLog === 'function') {
        await onLog(step, '等待短信验证码中...', 'info');
      }

      const remainingToMaxDurationMs = Math.max(0, MAX_DURATION_MS - elapsedMs);
      const nextWaitMs = Math.min(
        POLL_INTERVAL_MS,
        remainingToMaxDurationMs,
        Math.max(0, timeoutMs - elapsedMs)
      );

      if (nextWaitMs > 0) {
        await sleepWithStopCheck(nextWaitMs, stopCheck);
      }
    }

    throw new Error('等待短信验证码超时（5分钟）');
  }

  async function appendPhoneCodeIfNew(phoneNumber, code) {
    const phoneKey = normalizePhoneRecordKey(phoneNumber);
    const normalizedCode = normalizeCodeValue(code);
    if (!phoneKey || !normalizedCode) {
      return {
        added: false,
        duplicate: false,
        exhausted: false,
        codes: [],
      };
    }

    const records = await getHeroSmsPhoneRecords();
    const existingCodes = getPhoneCodesFromRecords(records, phoneKey);

    if (existingCodes.includes(normalizedCode)) {
      return {
        added: false,
        duplicate: true,
        exhausted: existingCodes.length >= HERO_SMS_MAX_RECEIVED_CODE_COUNT,
        codes: existingCodes,
      };
    }

    if (existingCodes.length >= HERO_SMS_MAX_RECEIVED_CODE_COUNT) {
      return {
        added: false,
        duplicate: false,
        exhausted: true,
        codes: existingCodes,
      };
    }

    const nextCodes = [...existingCodes, normalizedCode].slice(0, HERO_SMS_MAX_RECEIVED_CODE_COUNT);
    records[phoneKey] = nextCodes;
    await setHeroSmsPhoneRecords(records);

    return {
      added: true,
      duplicate: false,
      exhausted: nextCodes.length >= HERO_SMS_MAX_RECEIVED_CODE_COUNT,
      codes: nextCodes,
    };
  }

  return {
    HERO_SMS_BASE_URL,
    HERO_SMS_BLOCKED_PHONE_DURATION_MS,
    HERO_SMS_BLOCKED_PHONE_RECORDS_STORAGE_KEY,
    HERO_SMS_EXHAUSTED_PHONE_RECORDS_STORAGE_KEY,
    HERO_SMS_FIRST_CODE_TIMEOUT_ERROR_CODE,
    HERO_SMS_FIRST_CODE_TIMEOUT_MS,
    HERO_SMS_MAX_RECEIVED_CODE_COUNT,
    HERO_SMS_NEXT_CODE_TIMEOUT_ERROR_CODE,
    HERO_SMS_NEXT_CODE_TIMEOUT_MS,
    HERO_SMS_PHONE_RECORDS_STORAGE_KEY,
    appendPhoneCodeIfNew,
    cancelActivation,
    createHeroSmsFirstCodeTimeoutError,
    createHeroSmsNextCodeTimeoutError,
    ensurePhoneRecord,
    findOrCreateSmsActivation,
    finishActivation,
    getActiveActivations,
    getHeroSmsBlockedPhoneRecords,
    getHeroSmsExhaustedPhoneRecords,
    getHeroSmsPhoneRecords,
    getNumberV2,
    getPhoneCodesFromRecords,
    getPhoneRecordStatus,
    getPhoneReuseDecision,
    getStatusV2,
    heroSmsRequest,
    isPhoneNumberBlocked,
    isPhoneNumberExhausted,
    markPhoneNumberBlocked,
    markPhoneNumberExhausted,
    normalizeCodeValue,
    normalizeHeroSmsActivationStatus,
    normalizePhoneRecordKey,
    pollSmsVerificationCode,
    prepareActivationForSmsRequest,
    resolveCodeTimeoutPolicyByCodeCount,
    setHeroSmsBlockedPhoneRecords,
    setHeroSmsExhaustedPhoneRecords,
    setHeroSmsPhoneRecords,
    setHeroSmsStatus,
    sleepWithStopCheck,
  };
});
