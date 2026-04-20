(function attachBackgroundStep5(root, factory) {
  root.MultiPageBackgroundStep5 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep5Module() {
  function createStep5Executor(deps = {}) {
    const {
      addLog,
      completeStepFromBackground,
      generateRandomBirthday,
      generateRandomName,
      sendToContentScript,
    } = deps;

    async function completeStep5BypassForExistingAccount(landingState = '', url = '') {
      const landingStateSuffix = landingState ? `（落点：${landingState}）` : '';
      await addLog(`步骤 5：当前邮箱已走已注册账号分支${landingStateSuffix}，无需填写姓名和生日，直接完成当前步骤。`, 'warn');
      await completeStepFromBackground(5, {
        skippedProfileForExistingAccount: true,
        directProceedToStep6: true,
        branch: 'existing_account_login',
        landingState,
        url,
      });
    }

    async function executeStep5(state = {}) {
      if (state?.skipSignupProfileStep) {
        await completeStep5BypassForExistingAccount('', '');
        return;
      }

      const { firstName, lastName } = generateRandomName();
      const { year, month, day } = generateRandomBirthday();

      await addLog(`步骤 5：已生成姓名 ${firstName} ${lastName}，生日 ${year}-${month}-${day}`);

      await sendToContentScript('signup-page', {
        type: 'EXECUTE_STEP',
        step: 5,
        source: 'background',
        payload: { firstName, lastName, year, month, day },
      });
    }

    return { executeStep5 };
  }

  return { createStep5Executor };
});
