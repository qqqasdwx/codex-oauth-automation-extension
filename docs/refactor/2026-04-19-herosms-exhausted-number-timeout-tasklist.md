# Hero-SMS 本地耗尽与按次发码超时修复 Tasklist

> 日期：2026-04-19  
> 目标：修复 Hero-SMS 在“同一手机号收到 1~2 次验证码后失效”场景下的错误复用问题，将超时判定从“activation 维度”调整为“本次点击发送短信按钮维度”，并以**低侵入、便于后续合并上游**的方式落地。

---

## 当前状态（2026-04-19）

- 已完成代码改造与测试回归
- 本文为新的独立 tasklist，与以下任务分开跟踪：
  - `2026-04-19-phone-verification-merge-tasklist.md`
  - `2026-04-19-outlookemail-provider-tasklist.md`
- 本轮目标仅聚焦：**Hero-SMS 号码在本地应判定为“耗尽并不再复用”的时机与超时策略修复**
- 已执行全量回归：`npm test`

---

## 一、问题背景

当前 Hero-SMS 已接入，但仍存在以下问题：

1. 同一个手机号并不是只有“完全可用”或“已收到 3 次验证码”两种状态
2. 某些号码可能在收到 **1 次或 2 次验证码后**，就已经无法再收到后续短信
3. 现有逻辑在这类号码上，会在 5 分钟超时后重试流程
4. 下一次 attempt 重新申请 / 复用号码时，仍可能再次拿回同一个号码
5. 由于该号码实际上已经不可用，流程会迅速再次超时，形成错误重试循环

根因有两类：

- 超时判定仍偏向 activation 生命周期，而不是“本次页面点击发送短信按钮”的等待窗口
- 本地仅记录“接码次数上限”和“首码 125 秒无短信的短期 blocked”，**没有覆盖“历史接过 1~2 次，但本轮再也收不到码”的本地耗尽语义**

---

## 二、已确认的业务规则

### 2.1 计时起点

- [x] 超时计时必须从“**本次点击发送短信按钮开始**”计算
- [x] 不是从 Hero-SMS activation 创建时间开始算
- [x] 不是从上一次成功接码时间开始算
- [x] 如果未来支持页面上的“重新发送验证码”，则应以“本次重发点击时间”作为新的计时起点

### 2.2 本地耗尽判定

- [x] 某号码历史 **0 次接码**，本次发码后 **2 分钟**仍未收到任何新验证码
  - [x] 视为“本地耗尽”
- [x] 某号码历史已接过 **1~2 次码**，本次发码后 **3 分钟**仍未收到新的验证码
  - [x] 视为“本地耗尽”
- [x] 某号码历史已接满 **3 次验证码**
  - [x] 继续保持现有语义，视为“本地耗尽”

### 2.3 超时后的处理策略

- [x] 超时后取消当前 Hero-SMS activation
- [x] 将该号码标记为“本地耗尽，不再复用”
- [x] 当前 attempt 失败
- [x] 交给外层 auto-run / retry 流程申请新号码并重走链路
- [x] 当前期**不假设页面一定支持回退并重新填写手机号**
- [x] 当前期**不在手机号页内直接做换号重填**

### 2.4 本地耗尽语义

- [x] 当前期不再区分“临时拉黑 / 永久拉黑”业务语义
- [x] 统一按“**本地耗尽，不再复用**”处理
- [x] 保留真实接码记录，不通过伪造第 3 个验证码来实现耗尽状态

---

## 三、实施原则

- [x] 尽量不要把大段新逻辑堆回：
  - [x] `background.js`
  - [x] `sidepanel/sidepanel.js`
- [x] 优先在现有职责域内扩展：
  - [x] `hero-sms-utils.js`
  - [x] `background/phone-verification.js`
  - [x] `background/logging-status.js`
  - [x] `background/auto-run-controller.js`
- [x] 尽量低侵入，便于后续继续合并上游更新
- [x] 结构性改动必须补测试
- [x] 最终必须执行全量回归：`npm test`
- [x] 如本次实现导致链路、存储键、错误码或运行态字段变化，需同步更新：
  - [x] `README.md`
  - [x] `项目文件结构说明.md`
  - [x] `项目完整链路说明.md`
- [x] 涉及中文文案、日志、文档修改后必须做乱码检查

---

## 四、目标改造方案

### 4.1 `hero-sms-utils.js`

- [x] 新增“本地耗尽号码”存储域
  - [x] 建议新增 storage key：`heroSmsExhaustedPhoneRecords`
  - [x] 存储内容至少包含：
    - [x] `phoneNumber / phoneKey`
    - [x] `exhaustedAt`
    - [x] `reason`
    - [x] `receivedCodeCount`
- [x] 新增或等价实现以下能力：
  - [x] `getHeroSmsExhaustedPhoneRecords()`
  - [x] `setHeroSmsExhaustedPhoneRecords(records)`
  - [x] `markPhoneNumberExhausted(phoneNumber, options)`
  - [x] `isPhoneNumberExhausted(phoneNumber)`
- [x] 修改 `findOrCreateSmsActivation(...)`
  - [x] 跳过已接满 3 次的号码
  - [x] 跳过 blocked 号码
  - [x] 新增：跳过“本地耗尽”号码
- [x] 为号码补充“历史接码次数 -> 本次超时阈值”决策能力
  - [x] `0 次历史接码 -> 120000ms`
  - [x] `1~2 次历史接码 -> 180000ms`
  - [x] `>=3 次 -> 直接视为不可复用`
- [x] 调整 `pollSmsVerificationCode(...)` 入参语义
  - [x] 不再只使用 `firstCodeTimeoutStartedAt`
  - [x] 改为接收“本次发码请求时间”，例如：`smsRequestStartedAt`
  - [x] 超时阈值根据历史接码次数动态决定
- [x] 将 Hero-SMS 状态切换改为“按本次发送动作驱动”
  - [x] 首次发码不再在拿号阶段预先切到“等待新短信”
  - [x] 若号码历史已接过验证码，则在本次页面触发发送短信前调用等待新短信状态切换
- [x] 保留现有首码超时能力，同时覆盖“次码/后续码超时”能力
  - [x] 建议保留 `HERO_SMS_FIRST_CODE_TIMEOUT::*`
  - [x] 建议新增 `HERO_SMS_NEXT_CODE_TIMEOUT::*`
  - [x] 或者落为统一错误码，但必须提供共享判定能力以覆盖两类超时
- [x] 超时后的收尾职责统一下沉到工具层
  - [x] cancel activation
  - [x] mark exhausted
  - [x] 输出可用于日志的错误信息
- [x] 明确：不要通过伪造第 3 个验证码来标记号码耗尽

### 4.2 `background/phone-verification.js`

- [x] 新增运行态字段
  - [x] 建议新增：`currentHeroSmsRequestStartedAt`
- [x] 调整运行态写入时机
  - [x] 获取 / 复用 activation 时，继续记录 activation 级字段
  - [x] **点击发送短信按钮后**，记录 `currentHeroSmsRequestStartedAt`
- [x] 在页面点击发送短信前，先根据号码历史接码次数准备 Hero-SMS activation 状态
- [x] 调整调用 `heroPollSmsVerificationCode(...)` 的参数
  - [x] 传入 `smsRequestStartedAt`
  - [x] 不再把 activation 创建时间当成本次发码超时起点
- [x] 清理逻辑同步更新
  - [x] `cleanupHeroSmsActivation(...)` 需清理 `currentHeroSmsRequestStartedAt`
- [x] 错误传播保持稳定
  - [x] 首码超时与次码超时都继续抛给外层
  - [x] 不在本模块内部假设页面可回退换号

### 4.3 `background/logging-status.js`

- [x] 扩展共享错误识别能力
  - [x] 保持兼容现有 `isHeroSmsFirstCodeTimeoutError(...)`
  - [x] 新增或等价支持“后续验证码超时”识别
- [x] 如果采用新共享命名，需保证旧调用点改造成本最小

### 4.4 `background/auto-run-controller.js`

- [x] 将“Hero-SMS 后续验证码超时”纳入与“首码超时”一致的恢复策略
  - [x] 当前 attempt 失败
  - [x] 若允许重试，则进入**同一轮的下一次 attempt**
  - [x] 不直接跳过整轮
  - [x] 不按 `phone_max_usage_exceeded` 处理
- [x] 失败留档需能区分：
  - [x] `phone_max_usage_exceeded`
  - [x] Hero-SMS 首码超时
  - [x] Hero-SMS 后续验证码超时

### 4.5 测试任务

- [x] `tests/hero-sms-utils.test.js`
  - [x] 覆盖“0 次历史接码 -> 2 分钟超时 -> 标记本地耗尽”
  - [x] 覆盖“1 次历史接码 -> 3 分钟超时 -> 标记本地耗尽”
  - [x] 覆盖“2 次历史接码 -> 3 分钟超时 -> 标记本地耗尽”
  - [x] 覆盖“本地耗尽号码不会再被 `findOrCreateSmsActivation(...)` 复用”
  - [x] 覆盖“真实接码记录与耗尽记录分离保存”
- [x] `tests/background-phone-verification-module.test.js`
  - [x] 覆盖“点击发送后记录 `currentHeroSmsRequestStartedAt`”
  - [x] 覆盖“次码超时后清理 Hero-SMS 运行态”
- [x] `tests/step9-phone-verification.test.js`
  - [x] 覆盖“Step 9 正确传播后续验证码超时错误”
- [x] `tests/auto-run-phone-max-usage.test.js`
  - [x] 覆盖“后续验证码超时走同轮 retry，而不是整轮终止”
- [x] 执行全量测试
  - [x] `npm test`

### 4.6 文档更新任务（代码落地后）

- [x] 若新增了 storage key / 错误码 / 运行态字段，更新：
  - [x] `README.md`
  - [x] `项目文件结构说明.md`
  - [x] `项目完整链路说明.md`
- [x] 回填本文 tasklist 完成状态
- [x] 对本次修改涉及的中文文档、中文日志、中文提示做乱码审查

---

## 五、验收标准

### 5.1 功能验收

- [x] 某号码历史从未接过码时：
  - [x] 从“本次点击发送短信按钮”开始计时
  - [x] 2 分钟内没有任何新验证码
  - [x] 当前 activation 被取消
  - [x] 该号码被记录为“本地耗尽”
  - [x] 当前 attempt 失败
  - [x] 下一次 attempt 不再复用该号码

- [x] 某号码历史已接过 1 次或 2 次码时：
  - [x] 从“本次点击发送短信按钮”开始计时
  - [x] 3 分钟内没有新的验证码
  - [x] 当前 activation 被取消
  - [x] 该号码被记录为“本地耗尽”
  - [x] 当前 attempt 失败
  - [x] 下一次 attempt 不再复用该号码

- [x] 某号码达到 3 次真实接码上限时：
  - [x] 继续按现有语义结束 activation
  - [x] 不影响现有成功接码流程

### 5.2 行为边界验收

- [x] 超时起点严格以“本次点击发送短信按钮时间”为准，不受以下时间影响：
  - [x] activation 创建时间
  - [x] 上一次成功接码时间
  - [x] 更早页面停留时间
- [x] 新逻辑不会把 Hero-SMS 超时误判为 `phone_max_usage_exceeded`
- [x] 新逻辑不会在当前手机号页内强行执行“回退并重填号码”
- [x] `heroSmsEnabled = false` 时，现有非 Hero-SMS 链路行为保持不变

### 5.3 工程验收

- [x] 主要新增逻辑下沉到模块，不把大段逻辑堆回 `background.js`
- [x] 相关测试已补齐并通过 `npm test`
- [x] 文档已同步更新
- [x] 本次修改涉及的中文内容无可见乱码

---

## 六、当前明确不做

- [x] 不在当前期实现“手机号页内直接更换号码并继续提交”的页面级复杂回退流程
- [x] 不在当前期引入“临时拉黑 / 永久拉黑”两套并行语义
- [x] 不通过伪造短信记录来模拟号码耗尽
- [x] 不为该问题重新设计整套 Hero-SMS provider 架构

---

## 七、建议实施顺序

- [x] 先改 `hero-sms-utils.js`，把“本地耗尽 + 动态超时 + 新错误语义”做扎实
- [x] 再改 `background/phone-verification.js`，切换为“按本次发码请求时间”驱动
- [x] 然后接 `logging-status` / `auto-run-controller`
- [x] 最后补测试、跑 `npm test`、更新文档、回填本文状态
