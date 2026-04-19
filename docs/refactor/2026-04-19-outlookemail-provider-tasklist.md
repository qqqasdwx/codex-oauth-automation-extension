# OutlookEmail 新 Provider 接入 Tasklist

> 日期：2026-04-19  
> 目标：将 `references/outlookEmail` 作为**独立新功能**接入当前仓库，提供一套**不影响现有 Hotmail 账号池**的邮箱池对接能力。  
> 本任务与 `2026-04-19-phone-verification-merge-tasklist.md` **无关**，单独跟踪。

## 当前状态（2026-04-19）

- 已完成 OutlookEmail 独立 provider 接入
- 已完成 sidepanel 配置区、分组拉取、流程分配、Step 4/8 轮询、Step 10 成功移组
- 已补充 OutlookEmail 相关测试并执行通过：`npm test`
- 本文下方原始 tasklist 继续保留，作为实施留档与验收清单

---

## 一、实施目标

实现以下业务闭环：

1. 在侧边栏填写 `OutlookEmail Base URL` 与 `OutlookEmail 登录密码`
2. 通过已部署的 `outlookEmail` 服务登录并拉取分组列表
3. 用户分别选择：
   - 注册邮箱池分组
   - 注册成功分组
4. 注册流程运行时，从“注册邮箱池分组”拉取邮箱账号并参与注册
5. 步骤 4 / 8 通过 `outlookEmail` 的邮件接口拉取验证码
6. 整条链路注册成功后，将当前邮箱移动到“注册成功分组”
7. 全程不影响现有：
   - `hotmail-api`
   - `luckmail-api`
   - Hero-SMS / 手机号验证

---

## 二、实施原则

- 保持为**新 provider**，不复用、不污染现有 `hotmail-api` 账号池逻辑
- **不修改 `references/outlookEmail` 源码**，优先直接调用其现有 Web API
- 优先新增模块，避免将大段逻辑重新堆回：
  - `background.js`
  - `sidepanel/sidepanel.js`
- 当前阶段仅依赖：
  - `Base URL`
  - `登录密码`
- 当前阶段**不强制依赖 API Key**
- `mailProvider !== outlookemail-api` 时，当前仓库行为必须与现状一致
- 所有新增中文文案、日志、文档必须检查乱码
- 功能落地后必须补测试并更新文档

---

## 三、接口策略（不改 OutlookEmail 源码）

当前阶段统一采用 **登录态 + Session Cookie + CSRF** 方式对接 `outlookEmail`。

### 3.1 计划使用的现有接口

- `POST /login`
  - 用途：登录并建立 Session
- `GET /api/groups`
  - 用途：拉取分组列表，供侧边栏下拉选择
- `GET /api/accounts?group_id=<id>`
  - 用途：拉取某分组下的账号列表
- `GET /api/emails/<email>?folder=all&top=<n>`
  - 用途：读取指定邮箱的邮件列表，用于验证码轮询
- `GET /api/csrf-token`
  - 用途：获取 POST 类接口需要的 CSRF Token
- `POST /api/accounts/batch-update-group`
  - 用途：注册成功后将邮箱移动到“注册成功分组”

### 3.2 当前阶段明确不做

- 不修改 `outlookEmail` 增加 external API
- 不引入 API Key 作为必填配置
- 不接入 `outlookEmail` 的 project claim/release 机制
- 不做多实例抢占保护型服务端锁定

### 3.3 当前阶段并发假设

- 默认按**单实例 / 单扩展主要使用场景**落地
- 当前成功态通过“移动到成功分组”实现出池
- 失败态默认不自动移组，维持源分组不变
- 若后续存在多实例并发抢号需求，再单独规划二期方案

---

## 四、目标架构

### 4.1 新 provider 标识

- [ ] 新增 provider：`outlookemail-api`
- [ ] UI 文案命名与现有 provider 区分清晰，不与 `hotmail-api` 混淆
- [ ] 日志与状态文案单独区分 `OutlookEmail` / `Hotmail` 两条链路

### 4.2 推荐新增模块

- [ ] `background/outlook-email-provider.js`
  - 职责：封装 `outlookEmail` 登录、分组获取、账号获取、邮件获取、移组操作
- [ ] `sidepanel/outlook-email-manager.js`
  - 职责：管理 OutlookEmail 配置区、拉分组、下拉框、账号同步交互
- [ ] 可选：`outlook-email-utils.js`
  - 职责：provider 常量、数据归一化、显示文案、选择策略等纯工具

### 4.3 运行态边界

- [ ] `background.js` 只做装配与少量挂点
- [ ] `sidepanel/sidepanel.js` 只做接线与状态同步
- [ ] 核心 API 请求与 provider 行为下沉到独立模块

---

## 五、侧边栏配置与交互任务

### 5.1 `sidepanel/sidepanel.html`

- [ ] 新增邮箱服务选项：`OutlookEmail（邮箱池）`
- [ ] 新增 OutlookEmail 配置区：
  - [ ] `OutlookEmail Base URL`
  - [ ] `OutlookEmail 登录密码`
  - [ ] `拉取分组`按钮
  - [ ] `注册邮箱池分组`下拉
  - [ ] `注册成功分组`下拉
- [ ] 根据 provider 切换显示/隐藏 OutlookEmail 配置区
- [ ] 中文文案与 placeholder 明确，避免与 Hotmail 区混淆

### 5.2 `sidepanel/outlook-email-manager.js`

- [ ] 新建 manager，避免继续膨胀 `sidepanel/sidepanel.js`
- [ ] 管理 Base URL / 密码输入
- [ ] 管理“拉取分组”按钮状态
- [ ] 管理分组下拉选项渲染
- [ ] 管理错误提示、登录失败提示、空分组提示
- [ ] 向主 sidepanel 暴露最小接口：
  - [ ] `bind()`
  - [ ] `collectSettings()`
  - [ ] `applySettings()`
  - [ ] `renderGroups()`

### 5.3 `sidepanel/sidepanel.js`

- [ ] 最小化接线 OutlookEmail manager
- [ ] 在设置收集逻辑中合并：
  - [ ] `outlookEmailBaseUrl`
  - [ ] `outlookEmailPassword`
  - [ ] `outlookEmailSourceGroupId`
  - [ ] `outlookEmailSuccessGroupId`
- [ ] 在状态回填逻辑中恢复 OutlookEmail 配置
- [ ] 在 provider 切换时正确切换 OutlookEmail 区域显示状态

---

## 六、后台 Provider 能力任务

### 6.1 `background/outlook-email-provider.js`

- [ ] 新建工厂：`createOutlookEmailProviderHelpers(deps)`
- [ ] 暴露核心能力：
  - [ ] `loginOutlookEmail()`
  - [ ] `fetchOutlookEmailGroups()`
  - [ ] `fetchOutlookEmailAccounts(groupId)`
  - [ ] `fetchOutlookEmailMessages(email, options)`
  - [ ] `moveOutlookEmailAccountsToGroup(accountIds, groupId)`
  - [ ] `ensureOutlookEmailCsrfToken()`
  - [ ] `ensureOutlookEmailAccountForFlow(options)`
  - [ ] `pollOutlookEmailVerificationCode(step, state, pollPayload)`
- [ ] 对接口返回做统一归一化
- [ ] 对常见失败场景提供统一错误文案：
  - [ ] Base URL 无效
  - [ ] 登录失败
  - [ ] 分组获取失败
  - [ ] 账号列表为空
  - [ ] 邮件拉取失败
  - [ ] 移组失败
  - [ ] Session 过期

### 6.2 Session / CSRF 策略

- [ ] 登录成功后复用 Session Cookie
- [ ] POST 前按需获取 / 刷新 CSRF Token
- [ ] Session 失效时支持自动重登一次
- [ ] 不把复杂 Session 逻辑散落到多个文件

### 6.3 数据归一化

- [ ] 统一归一化 group 数据：
  - [ ] `id`
  - [ ] `name`
  - [ ] `color`
  - [ ] `accountCount`
- [ ] 统一归一化 account 数据：
  - [ ] `id`
  - [ ] `email`
  - [ ] `groupId`
  - [ ] `status`
  - [ ] `provider`
  - [ ] `accountType`
- [ ] 统一归一化 email message 数据，尽量复用现有验证码筛选逻辑所需结构

---

## 七、流程接入任务

### 7.1 `background.js`

- [ ] `importScripts(...)` 增加 OutlookEmail provider 模块
- [ ] `PERSISTED_SETTING_DEFAULTS` 增加：
  - [ ] `outlookEmailBaseUrl: ''`
  - [ ] `outlookEmailPassword: ''`
  - [ ] `outlookEmailSourceGroupId: ''`
  - [ ] `outlookEmailSuccessGroupId: ''`
  - [ ] `outlookEmailGroups: []`
  - [ ] `outlookEmailAccounts: []`
- [ ] `normalizePersistentSettingValue()` 增加对应归一化逻辑
- [ ] 初始化 `outlookEmailProviderHelpers`
- [ ] 将依赖注入到现有 signup / verification / message-router 相关模块

### 7.2 `background/signup-flow-helpers.js`

- [ ] 新增 `OutlookEmail` provider 分支
- [ ] 在 Step 2 前，当 `mailProvider === outlookemail-api` 时：
  - [ ] 从选定源分组拉取账号列表
  - [ ] 选择当前运行邮箱
  - [ ] 将邮箱写回共享 state
- [ ] 保持现有 Hotmail / LuckMail / Gmail / 2925 行为不变

### 7.3 `background/verification-flow.js`

- [ ] 新增 `OutlookEmail` 验证码轮询分支
- [ ] Step 4 / 8 在 `mailProvider === outlookemail-api` 时：
  - [ ] 调用 `pollOutlookEmailVerificationCode(...)`
  - [ ] 继续复用现有验证码过滤、排重、时间窗口逻辑
- [ ] 不复制一套新的验证码匹配规则

### 7.4 成功收尾逻辑

- [ ] 在整条链路成功完成后，若当前 provider 为 `outlookemail-api`：
  - [ ] 获取当前账号 ID
  - [ ] 调用移组接口，将账号移动到“注册成功分组”
  - [ ] 写成功日志
- [ ] 若移组失败：
  - [ ] 明确记录错误日志
  - [ ] 不静默吞错
  - [ ] 明确决定是否影响主流程成功态（建议：主流程已成功，但移组失败单独告警）

### 7.5 `background/message-router.js`

- [ ] 新增消息类型：
  - [ ] 拉取分组
  - [ ] 测试登录 / 测试连接
  - [ ] 同步账号池（如需要）
- [ ] 将 sidepanel 请求路由到 OutlookEmail provider 模块
- [ ] 避免把 HTTP 细节直接写在 router 中

---

## 八、账号选择与复用策略

### 8.1 当前阶段策略

- [ ] 从“注册邮箱池分组”拉取账号列表
- [ ] 优先选择状态正常的账号
- [ ] 当前轮优先复用已选中的当前账号（若存在）
- [ ] 当未选中当前账号时，再按既定顺序挑选下一个账号

### 8.2 当前阶段暂不做

- [ ] 不做服务端 claim / lease 锁定
- [ ] 不做失败自动移到其他分组
- [ ] 不做多实例竞争控制

### 8.3 风险留档

- [ ] 在任务文档 / 最终说明中明确记录：当前方案适合单实例优先场景

---

## 九、测试任务

### 9.1 纯逻辑 / 工具测试

- [ ] 新增 OutlookEmail 数据归一化测试
- [ ] 新增分组 / 账号 / 邮件返回解析测试
- [ ] 新增 Session 失效后自动重登测试
- [ ] 新增 CSRF Token 获取与 POST 请求组装测试

### 9.2 流程接入测试

- [ ] 新增 Step 2 OutlookEmail 邮箱分配测试
- [ ] 新增 Step 4 OutlookEmail 注册验证码轮询测试
- [ ] 新增 Step 8 OutlookEmail 登录验证码轮询测试
- [ ] 新增成功后移组调用测试
- [ ] 新增 provider 切换不影响 Hotmail / LuckMail 的回归测试

### 9.3 UI 接线测试

- [ ] 新增 sidepanel OutlookEmail 配置区显示/隐藏测试
- [ ] 新增“拉取分组”按钮行为测试
- [ ] 新增分组下拉恢复与保存测试

### 9.4 回归要求

- [ ] 执行全量回归：`npm test`
- [ ] 检查本次改动涉及文件无乱码

---

## 十、文档任务

- [ ] 更新 `README.md`
- [ ] 更新 `项目文件结构说明.md`
- [ ] 更新 `项目完整链路说明.md`
- [ ] 如实现细节发生变化，再补充本 tasklist 状态

---

## 十一、验收标准

### A. 配置与连接

- [ ] 侧边栏可选择 `OutlookEmail（邮箱池）`
- [ ] 用户只需填写：
  - [ ] `OutlookEmail Base URL`
  - [ ] `OutlookEmail 登录密码`
- [ ] 点击“拉取分组”后可成功展示分组下拉列表
- [ ] 能正确保存并恢复：
  - [ ] 注册邮箱池分组
  - [ ] 注册成功分组

### B. 流程运行

- [ ] 运行时可从“注册邮箱池分组”获取邮箱账号
- [ ] Step 2 能使用 OutlookEmail 邮箱完成注册邮箱提交
- [ ] Step 4 / 8 能从 OutlookEmail 邮件接口拉到验证码
- [ ] 验证码筛选、排重、时间窗口与现有逻辑兼容

### C. 成功收尾

- [ ] 当整条链路成功完成后，当前邮箱会被移动到“注册成功分组”
- [ ] 移组成功时有明确日志
- [ ] 移组失败时有明确错误日志，不静默失败

### D. 兼容性

- [ ] `hotmail-api` 行为不变
- [ ] `luckmail-api` 行为不变
- [ ] Hero-SMS / 手机号验证逻辑不变
- [ ] 非 OutlookEmail provider 时，当前仓库行为与现状一致

### E. 工程要求

- [ ] 测试通过：`npm test`
- [ ] 文档已更新
- [ ] 本次新增或修改的中文内容无乱码

---

## 十二、建议实施顺序

### Phase 1：基础接通

- [ ] 新增 provider 配置项与 sidepanel 配置区
- [ ] 实现登录、拉分组、选择分组
- [ ] 实现账号列表拉取与账号分配

### Phase 2：验证码接入

- [ ] 接入 Step 4 / 8 邮件拉取
- [ ] 复用现有验证码轮询与筛选逻辑

### Phase 3：成功态移组

- [ ] 接入成功后移组逻辑
- [ ] 增加失败日志与提示

### Phase 4：回归与文档

- [ ] 补测试
- [ ] 跑全量回归
- [ ] 更新 README / 结构文档 / 链路文档
