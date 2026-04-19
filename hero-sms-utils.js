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
  const HERO_SMS_BLOCKED_PHONE_DURATION_MS = 6 * 60 * 60 * 1000;
  const HERO_SMS_FIRST_CODE_TIMEOUT_MS = 125_000;
  const HERO_SMS_FIRST_CODE_TIMEOUT_ERROR_CODE = 'HERO_SMS_FIRST_CODE_TIMEOUT::no_first_sms_in_125s';

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

  function createHeroSmsFirstCodeTimeoutError(phoneNumber = '', timeoutMs = HERO_SMS_FIRST_CODE_TIMEOUT_MS) {
    const timeoutSeconds = Math.ceil(Math.max(0, Number(timeoutMs) || HERO_SMS_FIRST_CODE_TIMEOUT_MS) / 1000);
    const normalizedPhoneNumber = String(phoneNumber || '').trim();
    const phoneMessage = normalizedPhoneNumber
      ? `（手机号 ${normalizedPhoneNumber} 在 ${timeoutSeconds} 秒内未收到任何验证码）`
      : `（在 ${timeoutSeconds} 秒内未收到任何验证码）`;
    return new Error(`${HERO_SMS_FIRST_CODE_TIMEOUT_ERROR_CODE}${phoneMessage}`);
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
      .slice(0, 3);
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
    const records = await getHeroSmsPhoneRecords();
    const codes = getPhoneCodesFromRecords(records, phoneNumber);
    return {
      key: normalizePhoneRecordKey(phoneNumber),
      codes,
      usable: codes.length < 3,
      exhausted: codes.length >= 3,
    };
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
        exhausted: existingCodes.length >= 3,
        codes: existingCodes,
      };
    }

    if (existingCodes.length >= 3) {
      return {
        added: false,
        duplicate: false,
        exhausted: true,
        codes: existingCodes,
      };
    }

    const nextCodes = [...existingCodes, normalizedCode].slice(0, 3);
    records[phoneKey] = nextCodes;
    await setHeroSmsPhoneRecords(records);

    return {
      added: true,
      duplicate: false,
      exhausted: nextCodes.length >= 3,
      codes: nextCodes,
    };
  }

  async function findOrCreateSmsActivation(apiKey, targetCountry) {
    const result = await getActiveActivations(apiKey);
    if (!result || result.status !== 'success' || !Array.isArray(result.data)) {
      throw new Error('获取短信激活列表失败');
    }

    const records = await getHeroSmsPhoneRecords();
    const blockedPhoneRecords = await getHeroSmsBlockedPhoneRecords();
    const candidates = result.data
      .filter((item) => {
        const countryMatches = String(item.countryCode || '') === String(targetCountry || '');
        const serviceCode = String(item.serviceCode || item.service || '').trim().toLowerCase();
        const serviceMatches = !serviceCode || serviceCode === 'dr';
        const codeCount = getPhoneCodesFromRecords(records, item.phoneNumber).length;
        const blocked = normalizeBlockedUntilValue(blockedPhoneRecords[normalizePhoneRecordKey(item.phoneNumber)]) > Date.now();
        return countryMatches && serviceMatches && codeCount < 3 && !blocked;
      })
      .sort((left, right) => new Date(right.activationTime || 0) - new Date(left.activationTime || 0));

    const chosen = candidates[0] || null;
    if (chosen) {
      await ensurePhoneRecord(chosen.phoneNumber);
      await setHeroSmsStatus(apiKey, chosen.activationId, 3).catch(() => null);
      return {
        activationId: chosen.activationId,
        phoneNumber: chosen.phoneNumber,
      };
    }

    const nextActivation = await getNumberV2(apiKey, targetCountry);
    if (!nextActivation || !nextActivation.activationId) {
      throw new Error('获取新的短信号码失败');
    }

    await ensurePhoneRecord(nextActivation.phoneNumber);
    await setHeroSmsStatus(apiKey, nextActivation.activationId, 3).catch(() => null);

    return {
      activationId: nextActivation.activationId,
      phoneNumber: nextActivation.phoneNumber,
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
    const FIRST_CODE_TIMEOUT_MS = Math.min(
      MAX_DURATION_MS,
      Math.max(1, Math.floor(Number(resolvedOptions.firstCodeTimeoutMs) || HERO_SMS_FIRST_CODE_TIMEOUT_MS))
    );
    let trackedPhoneNumber = String(resolvedOptions.initialPhoneNumber || '').trim();
    let hasSeenAnySmsCode = false;
    const startedAt = Math.floor(Number(resolvedOptions.firstCodeTimeoutStartedAt) || 0) || Date.now();

    while (Date.now() - startedAt < MAX_DURATION_MS) {
      if (typeof stopCheck === 'function') {
        await stopCheck();
      }

      const result = await getActiveActivations(apiKey);
      if (result && result.status === 'success' && Array.isArray(result.data)) {
        const current = result.data.find((item) => String(item.activationId) === String(activationId));
        const phoneNumber = String(current?.phoneNumber || trackedPhoneNumber || '').trim();
        const smsCode = normalizeCodeValue(current?.smsCode);
        if (phoneNumber) {
          trackedPhoneNumber = phoneNumber;
        }

        if (phoneNumber && smsCode) {
          hasSeenAnySmsCode = true;
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
      if (!hasSeenAnySmsCode && elapsedMs >= FIRST_CODE_TIMEOUT_MS) {
        if (trackedPhoneNumber) {
          await markPhoneNumberBlocked(trackedPhoneNumber).catch(() => null);
        }

        if (typeof onLog === 'function') {
          await onLog(
            step,
            `当前手机号 ${trackedPhoneNumber || 'unknown'} 在 ${Math.ceil(FIRST_CODE_TIMEOUT_MS / 1000)} 秒内未收到任何验证码，正在放弃该号码并重新申请新号码...`,
            'warn'
          );
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

        throw createHeroSmsFirstCodeTimeoutError(trackedPhoneNumber, FIRST_CODE_TIMEOUT_MS);
      }

      if (typeof onLog === 'function') {
        await onLog(step, '等待短信验证码中...', 'info');
      }

      const remainingToMaxDurationMs = Math.max(0, MAX_DURATION_MS - elapsedMs);
      let nextWaitMs = Math.min(POLL_INTERVAL_MS, remainingToMaxDurationMs);
      if (!hasSeenAnySmsCode) {
        nextWaitMs = Math.min(nextWaitMs, Math.max(0, FIRST_CODE_TIMEOUT_MS - elapsedMs));
      }

      if (nextWaitMs > 0) {
        await sleepWithStopCheck(nextWaitMs, stopCheck);
      }
    }

    throw new Error('等待短信验证码超时（5分钟）');
  }

  return {
    HERO_SMS_BASE_URL,
    HERO_SMS_BLOCKED_PHONE_DURATION_MS,
    HERO_SMS_BLOCKED_PHONE_RECORDS_STORAGE_KEY,
    HERO_SMS_FIRST_CODE_TIMEOUT_ERROR_CODE,
    HERO_SMS_FIRST_CODE_TIMEOUT_MS,
    HERO_SMS_PHONE_RECORDS_STORAGE_KEY,
    appendPhoneCodeIfNew,
    cancelActivation,
    createHeroSmsFirstCodeTimeoutError,
    ensurePhoneRecord,
    findOrCreateSmsActivation,
    finishActivation,
    getActiveActivations,
    getHeroSmsBlockedPhoneRecords,
    getHeroSmsPhoneRecords,
    getNumberV2,
    getPhoneCodesFromRecords,
    getPhoneRecordStatus,
    getStatusV2,
    heroSmsRequest,
    isPhoneNumberBlocked,
    markPhoneNumberBlocked,
    normalizeCodeValue,
    normalizePhoneRecordKey,
    pollSmsVerificationCode,
    setHeroSmsBlockedPhoneRecords,
    setHeroSmsPhoneRecords,
    setHeroSmsStatus,
    sleepWithStopCheck,
  };
});
