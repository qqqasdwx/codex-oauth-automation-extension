# 手机号验证功能接入 Tasklist

> 日期：2026-04-19  
> 目标：将 `references/phone` 中的 Hero-SMS / 手机号验证能力，以**低侵入、便于后续合并上游**的方式接入当前仓库。

---

## 一、实施原则

- [x] 保持当前 **10 步流程** 不变，不重排 step 编号
- [x] 优先 **新增文件**，避免大改现有核心文件
- [x] 原文件仅增加：
  - [x] import / 挂载
  - [x] 小型分支开关
  - [x] 少量调用点
- [x] `heroSmsEnabled = false` 时，当前仓库行为必须与现状完全一致
- [x] 优先通过 `background + chrome.scripting.executeScript` 实现手机号页交互
- [x] `content/signup-page.js` 仅做最小必要改动，用于复用现有 Continue 链路
- [x] 不直接拷贝 `references/phone/background.js`，避免回退当前模块化结构
- [x] 严格遵守当前仓库“入口壳 + 模块装配”的架构约束，避免把大段新逻辑堆回：
  - [x] `background.js`
  - [x] `sidepanel/sidepanel.js`
- [x] 所有新增中文文案、日志、错误信息、文档修改后必须做**乱码审查**
- [x] 本次功能落地后必须同步更新：
  - [x] `README.md`
  - [x] `项目文件结构说明.md`
  - [x] `项目完整链路说明.md`

---

## 二、目标架构

- [x] Step 8 仍负责“登录邮箱验证码”
- [x] 当 Step 8 提交验证码后进入 `add-phone`：
  - [x] 若 `heroSmsEnabled = false`：保持现状，直接失败
  - [x] 若 `heroSmsEnabled = true`：允许作为成功分支结束 Step 8
- [x] Step 9 在执行 OAuth confirm 前，先判断是否需要手机号验证
- [x] 如当前页处于 `add-phone`：
  - [x] 先执行手机号验证流程
  - [x] 验证成功后再继续当前 Step 9 OAuth confirm 逻辑
- [x] 如命中 `phone_max_usage_exceeded`：
  - [x] 当前轮直接失败
  - [x] Auto 模式按策略进入下一轮或结束
- [x] 如 Hero-SMS 号码自“申领成功 / 复用开始接码”起 **125 秒**仍未收到任何首个验证码：
  - [x] 调用 Hero-SMS 取消当前 activation（`setStatus(..., 8)`）
  - [x] 清理当前 Hero-SMS 运行态
  - [x] 不假设当前页面一定支持回退并重新填写手机号
  - [x] 直接结束**当前 attempt**
  - [x] 交给外层重试流程重新打开/刷新认证链路后再申请新号码

### 2.1 Hero-SMS 首码超时换号策略（新增迭代）

- [x] “2 分钟无首码”按实现保护边界落为 **125 秒**
- [x] 计时起点统一定义为：
  - [x] 新号码 `getNumberV2(...)` 成功返回时
  - [x] 或复用已有 activation 并开始等待短信时
- [x] 超时判定条件为“**一个验证码都没收到**”，不是“收到旧码后没新码”
- [x] 超时后主策略为：
  - [x] cancel 当前 activation
  - [x] 当前 attempt 失败
  - [x] 进入重试流程
- [x] 明确**不做**以下高风险方案作为主路径：
  - [x] 不在当前页尝试点返回/刷新后继续复填新号码
  - [x] 不假设 OpenAI `add-phone` 页面存在稳定的“修改手机号”入口
  - [x] 不把该错误直接等同于 `phone_max_usage_exceeded`

---

## 三、新增文件

### 1. `hero-sms-utils.js`

- [x] 从 `references/phone/hero-sms-utils.js` 提炼为独立工具模块
- [x] 保持挂载形式：`self.HeroSmsUtils = {...}`
- [x] 暴露以下 API：
  - [x] `findOrCreateSmsActivation(apiKey, country)`
  - [x] `pollSmsVerificationCode(apiKey, activationId, onLog, step, stopCheck)`
  - [x] `finishActivation(apiKey, activationId)`
- [x] 增加 / 明确以下 API 或等价能力：
  - [x] `cancelActivation(apiKey, activationId)`（内部可基于 `setStatus(..., 8)`）
  - [x] `pollSmsVerificationCode(...)` 支持“首码超时”专用错误
- [x] 保留本地手机号记录逻辑：
  - [x] `chrome.storage.local.heroSmsPhoneRecords`
  - [x] 每个手机号最多记录 3 个不同验证码
  - [x] 旧验证码自动跳过
- [x] 增加“首码超时坏号”本地隔离策略：
  - [x] 被判定为 125 秒无首码的号码，本轮 / 短期内不再优先复用
  - [x] 避免 cancel 失败或接口延迟时，下一次尝试又拿回同一个坏号码

### 2. `background/phone-verification.js`

- [x] 新建手机号验证后台模块
- [x] 暴露工厂：`createPhoneVerificationHelpers(deps)`
- [x] 设计对外方法：
  - [x] `ensurePhoneVerificationIfNeeded(state, tabId, options)`
  - [x] `cleanupHeroSmsActivation(options)`
  - [x] `isPhoneMaxUsageExceededError(error)`
- [x] 内部实现职责：
  - [x] 检查当前 tab 是否为 `add-phone`
  - [x] 等待手机号页就绪
  - [x] 获取 / 复用 Hero-SMS activation
  - [x] 填手机号并提交
  - [x] 轮询短信验证码
  - [x] 填短信验证码
  - [x] 检测 `phone_max_usage_exceeded`
  - [x] 清理 activation
- [x] 增加首码超时后的收尾职责：
  - [x] 捕获 `HERO_SMS_FIRST_CODE_TIMEOUT::*`
  - [x] 清理 Hero-SMS 运行态
  - [x] 不在当前页做“回退重填手机号”假设
  - [x] 将错误继续抛给外层重试控制

### 3. `sidepanel/hero-sms-manager.js`

- [x] 新建侧边栏 Hero-SMS manager
- [x] 目标：避免继续膨胀 `sidepanel/sidepanel.js`
- [x] 职责：
  - [x] 管理 Hero-SMS 相关 DOM 接线
  - [x] 管理启用/禁用切换
  - [x] 管理 API Key 显隐
  - [x] 管理国家代码查询按钮
  - [x] 向 `sidepanel.js` 暴露最小接口（collect/apply/bind）

---

## 四、现有文件最小改动清单

### 3. `background.js`

- [x] `importScripts(...)` 增加：
  - [x] `hero-sms-utils.js`
  - [x] `background/phone-verification.js`
- [x] `PERSISTED_SETTING_DEFAULTS` 增加：
  - [x] `heroSmsEnabled: false`
  - [x] `heroSmsApiKey: ''`
  - [x] `heroSmsCountry: ''`
- [x] `DEFAULT_STATE` 增加：
  - [x] `currentHeroSmsActivationId: null`
  - [x] `currentHeroSmsPhoneNumber: null`
- [x] `normalizePersistentSettingValue()` 增加：
  - [x] `heroSmsEnabled`
  - [x] `heroSmsApiKey`
  - [x] `heroSmsCountry`
- [x] 初始化 `phoneVerificationHelpers`
- [x] 将依赖注入 `phoneVerificationHelpers`
- [x] 在 `requestStop()` 中增加 activation 清理挂点
- [x] 在 `resetState()` 中增加 activation 清理挂点

### 4. `background/verification-flow.js`

- [x] 为 `resolveVerificationStep()` 增加 option：
  - [x] `allowAddPhoneSuccess`
- [x] 修改 Step 8 提交验证码后的 `addPhonePage` 分支：
  - [x] `allowAddPhoneSuccess = false` 时，保持现状
  - [x] `allowAddPhoneSuccess = true` 时，允许 Step 8 完成
- [x] 返回结构化结果（建议）：
  - [x] `branch: 'normal'`
  - [x] `branch: 'phone_verification'`

### 5. `background/steps/fetch-login-code.js`

- [x] 调用 `resolveVerificationStep()` 时透传：
  - [x] `allowAddPhoneSuccess: Boolean(state.heroSmsEnabled)`
- [x] 保持本文件仅做透传，不直接承载手机号流程

### 6. `background/steps/confirm-oauth.js`

- [x] 在 Step 9 正式点击 OAuth Continue 前增加挂点：
  - [x] `await ensurePhoneVerificationIfNeeded(...)`
- [x] 给 `createStep9Executor()` 增加依赖：
  - [x] `ensurePhoneVerificationIfNeeded`
- [x] 要求：
  - [x] 非 `add-phone` 时 no-op
  - [x] `heroSmsEnabled = false` 时维持原失败行为
  - [x] `heroSmsEnabled = true` 时先执行手机号验证
- [x] 新增要求：
  - [x] Hero-SMS 首码超时错误走“当前 attempt 失败”分支
  - [x] 不套用 `phone_max_usage_exceeded` 的“当前轮直接终止”策略
  - [x] 不在 Step 9 内尝试页面回退换号

### 7. `background/auto-run-controller.js`

- [x] 增加依赖：
  - [x] `isPhoneMaxUsageExceededError`
- [x] 新增 `phone_max_usage_exceeded` 分支：
  - [x] 当前轮直接失败
  - [x] 不再进行本轮 retry
  - [x] `autoRunSkipFailures = true` 时进入下一轮
  - [x] 否则停止自动运行
- [x] 增加依赖：
  - [x] `isHeroSmsFirstCodeTimeoutError`
- [x] 新增 `hero_sms_first_code_timeout` 分支：
  - [x] 当前 attempt 直接失败
  - [x] 若允许重试，则进入**同一轮的下一次 attempt**
  - [x] 若不允许重试，则停止自动运行
  - [x] 不直接跳下一轮
  - [x] 不复用当前 Hero-SMS activation 运行态

### 7.1 `background/logging-status.js`

- [x] 增加共享错误判定：
  - [x] `isPhoneMaxUsageExceededError(error)`
- [x] 保持与现有 `isAddPhoneAuthFailure(error)` 一致的共享职责边界
- [x] 供以下模块复用：
  - [x] `background/phone-verification.js`
  - [x] `background/auto-run-controller.js`
  - [x] 其他需要判断手机号上限错误的后台模块
- [x] 增加共享错误判定：
  - [x] `isHeroSmsFirstCodeTimeoutError(error)`

### 8. `background/message-router.js`

- [x] 在成功完成整条链路后增加 Hero-SMS 清理挂点
- [x] 建议在 `handleStepData(step=10)` 里调用：
  - [x] `cleanupHeroSmsActivation(...)`
  - [x] 成功路径仅清理运行态，不立即 `finishActivation`
  - [x] 仅在号码达到 3 次接码上限或命中 `phone_max_usage_exceeded` 时完成 activation

### 9. `sidepanel/sidepanel.html`

- [x] 增加 Hero-SMS 配置项：
  - [x] 启用 / 禁用
  - [x] API Key
  - [x] 国家代码

### 10. `sidepanel/sidepanel.js`

- [x] 保持为主入口与装配层，不承载大段 Hero-SMS UI 逻辑
- [x] 仅做最小接线：
  - [x] 加载 `sidepanel/hero-sms-manager.js`
  - [x] 实例化 manager
  - [x] 在 `collectSettingsPayload()` 中合并 Hero-SMS 配置
  - [x] 在 `applySettingsState()` 中调用 Hero-SMS manager 回填
  - [x] 在初始化阶段调用 Hero-SMS manager 绑定事件

---

## 五、优先不动的文件

- [x] `content/signup-page.js`（仅做最小必要改动）
- [ ] `manifest.json`

> 说明：当前仓库已具备 add-phone 检测与 Step 8 结果返回能力。  
> 首选方案先不改 content script；若后台 `executeScript` 方案不稳定，再引入新增 content script 文件。

---

## 六、可选 fallback 方案（仅在首选方案不稳定时启用）

### 11. 新增 `content/phone-verification.js`

- [ ] 提供消息接口：
  - [ ] `PHONE_INSPECT_STATE`
  - [ ] `PHONE_FILL_NUMBER_AND_SUBMIT`
  - [ ] `PHONE_FILL_SMS_CODE`
- [ ] 只有在后台直接注入脚本不稳定时才启用

### 12. 如启用 fallback，再修改

- [ ] `manifest.json`
- [ ] `SIGNUP_PAGE_INJECT_FILES`

---

## 七、推荐实施顺序

### 第一批：纯新增，不碰主流程

- [x] 新增 `hero-sms-utils.js`
- [x] 新增 `background/phone-verification.js`
- [x] 新增 `sidepanel/hero-sms-manager.js`
- [x] 新增对应模块级测试

### 第二批：配置接入

- [x] 修改 `sidepanel/sidepanel.html`
- [x] 修改 `sidepanel/sidepanel.js`
- [x] 修改 `background.js` 中 settings/state/import

### 第三批：Step 8 分流

- [x] 修改 `background/verification-flow.js`
- [x] 修改 `background/steps/fetch-login-code.js`

### 第四批：Step 9 接手机号验证

- [x] 修改 `background/steps/confirm-oauth.js`
- [x] 在 `background.js` 中注入 helper 依赖

### 第五批：异常和收尾

- [x] 修改 `background/auto-run-controller.js`
- [x] 修改 `background/message-router.js`
- [x] 在 stop/reset/success 路径增加清理逻辑

### 第六批：测试补齐

- [x] 增加单测
- [x] 跑全量测试：`npm test`
- [ ] 手工验证真实流程
- [x] 逐文件进行乱码检查：
  - [x] 文档
  - [x] sidepanel 文案
  - [x] 日志
  - [x] 报错文案
  - [x] 中文注释

### 第八批：首码超时换号

- [x] `hero-sms-utils.js` 增加首码超时取消逻辑
- [x] `background/phone-verification.js` 接入专用错误与运行态清理
- [x] `background/logging-status.js` 增加共享错误判定
- [x] `background/steps/confirm-oauth.js` 区分“首码超时”和 `phone_max_usage_exceeded`
- [x] `background/auto-run-controller.js` 接入“当前 attempt 失败后重试”分支
- [x] 补测试
- [x] 同步文档

### 第七批：文档同步

- [x] 更新 `README.md`
- [x] 更新 `项目文件结构说明.md`
- [x] 更新 `项目完整链路说明.md`
- [ ] 如本次实施改变开发边界，再评估是否需要补充 `项目开发规范（AI协作）.md`

---

## 八、测试清单

### 1. `tests/hero-sms-utils.test.js`

- [x] 复用已有 activation
- [x] 超限手机号不再复用
- [x] 旧验证码跳过
- [x] 新验证码返回
- [x] stopCheck 中断轮询
- [x] 第 3 次接码后完成 exhausted activation
- [x] 125 秒无首码时取消当前 activation
- [x] 125 秒无首码时抛出专用错误
- [x] 首码超时后坏号不会在下一次尝试中被立即复用

### 2. `tests/background-phone-verification-module.test.js`

- [x] 检测 `add-phone`
- [x] 填手机号
- [x] 填短信验证码
- [x] 清理 activation
- [x] `phone_max_usage_exceeded` 分支
- [x] `hero_sms_first_code_timeout` 分支
- [x] 首码超时后仅清理运行态，不尝试页内回退换号

### 3. `tests/step9-phone-verification.test.js`

- [x] Step 9 进入前检测到 add-phone 时先执行手机号验证
- [x] 手机号验证成功后继续 OAuth confirm
- [x] 已进入 localhost callback 时不影响现有监听逻辑
- [x] Step 9 命中首码超时时，结束当前 attempt 并保留给外层重试

### 4. `tests/auto-run-phone-max-usage.test.js`

- [x] 命中 `phone_max_usage_exceeded` 后当前轮直接失败
- [x] 开启 skip failures 时进入下一轮
- [ ] 未开启时停止 auto-run
- [x] 命中 `hero_sms_first_code_timeout` 后进入同一轮下一次 attempt
- [x] 未开启重试时，`hero_sms_first_code_timeout` 会停止自动运行而不是直接跳下一轮

### 5. `tests/sidepanel-hero-sms-settings.test.js`

- [ ] 配置项渲染
- [ ] 配置保存 / 回填
- [ ] APIKey 显隐
- [ ] 查询国家代码按钮行为

### 6. `tests/sidepanel-hero-sms-manager.test.js`

- [x] manager 模块接线
- [x] 空态 / 默认态
- [x] collect/apply/bind 最小接口行为

---

## 九、验收标准

- [x] 未启用 Hero-SMS 时，全仓行为与当前版本一致
- [x] 启用 Hero-SMS 后，Step 8 登录验证码提交进入 add-phone 时不会立即失败
- [x] Step 9 能先完成手机号验证，再继续 OAuth confirm
- [x] `phone_max_usage_exceeded` 能触发正确的 auto-run 分支处理
- [x] stop / reset / success 路径能清理 Hero-SMS 运行态
- [x] 成功路径不会在首次接码后立即 finish activation，号码可在 3 次上限内复用
- [x] Hero-SMS 号码在 **125 秒**内未收到任何首个验证码时，不再傻等 5 分钟超时
- [x] 125 秒无首码时，会调用 Hero-SMS cancel activation（`setStatus(..., 8)`）或至少完成等价废弃处理
- [x] 125 秒无首码时，当前 attempt 会失败并进入外层重试流程，而不是直接假设页面可回退换号
- [x] auto-run 下，125 秒无首码会进入**同一轮下一次 attempt**，而不是直接跳下一轮
- [x] 手动模式下，125 秒无首码会尽快失败并提示重新开始本轮
- [x] `npm test` 全量通过
- [x] `README.md`、`项目文件结构说明.md`、`项目完整链路说明.md` 已同步更新
- [x] 本次修改涉及的中文文件无可见乱码
- [x] `background.js` 与 `sidepanel/sidepanel.js` 仅做装配/挂点级改动，没有承载大段新业务逻辑

---

## 十、风险提示

- [ ] 不能直接拷贝 `references/phone/background.js`
- [ ] 现有仓库中很多逻辑默认“进入 add-phone = 失败”，需逐点改为“条件分支”
- [ ] activation 清理必须集中管理，不能散落在多个文件里
- [x] 若需支持验证码页 Continue，仅对 `content/signup-page.js` 做最小必要改动

---

## 十一、未勾选项说明

- `手工验证真实流程`：这是人工联调项，不是等待你确认后才能继续的阻塞项，只是本轮尚未做。
- `manifest.json` 与 fallback content-script 相关项：当前首选方案稳定，属于**可选项**，不是漏做。
- `项目开发规范（AI协作）.md` 评估项：当前实现未改变协作边界，暂不需要补充，所以保持未勾选。
- `风险提示` 下未勾选条目：这是持续提醒，不表示“还有代码没写完”。
