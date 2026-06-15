# 门诊候补号源与爽约恢复系统

一个可本地验证的、前后端分离的门诊候补号源管理系统，支持候补队列、发放确认机会、确认、过号、爽约释放、管理员手动恢复等完整流程。使用 **Express + SQLite + React + Vite + TailwindCSS** 构建，所有数据持久化到本地文件 `server/data/app.db`，服务重启后结果不变。

---

## 功能总览

| 模块 | 功能 |
|---|---|
| 🔐 认证 | 管理员/办事员两种角色，JWT Token 登录 |
| 🏥 术前核验工作台 | 按日期导入预约、化验/影像/知情/禁食四项核验、冻结材料不全、放行/强制放行、单笔撤销回滚、规则配置、权限校验、通知审计、CSV导入导出 |
| 🔄 改期工作台 | 按日期批量筛选待处理预约，同医生/同科室改签，冲突预览，批量执行，单笔撤销回滚 |
| 📅 号源管理 | 医生号源 CRUD、可用名额调整、筛选、候补人数统计 |
| 📋 候补队列 | 加入候补、重复加入校验、发放确认机会、确认、过号、查看下一位 |
| 🩺 预约管理 | 预约列表、手动标记爽约并释放号源、自动通知下一位（可配置） |
| 👤 患者管理 | 患者录入与搜索 |
| 🔔 通知日志 | 所有通知消息的完整留痕（机会/确认/过号/过期/恢复/手动） |
| ⚠️ 爽约 / 恢复 | 爽约记录列表、带原因恢复（所有角色必须提供真实原因，空值/纯空格均拒绝，前后端双重校验） |
| ⚙️ 全局配置 | 候补超时、恢复策略、权限开关等，全部持久化并带审计 |
| 📝 审计日志 | 队列变动、配置修改、时间控制、导出等全部操作的审计（仅 admin 可看） |
| ⏰ 时间控制 | 绝对时间设置、速度倍率、手动推进、手动触发超时扫描（README 详述） |
| 📥 导出 | 候补名单 CSV 导出（含联系方式可选） |

---

## 快速开始（零启动验收入口）

本项目提供**统一验收入口（从项目根目录一条命令搞定）**，自动串起安装、seed、服务启动、健康检查、API冒烟和跨重启二次验证。不再需要人工开窗口切目录、零散补命令。

```bash
# 进入项目根目录（任何后续命令都不需要再切子目录）
cd zgw-00130

# 推荐 —— 一次跑两轮验证：首次启动 + 跨重启换端口/数据目录
npm run smoke-test

# 或只跑一次启动验证（更快，适合开发快速自检）
npm run smoke-test:once
```

**常用参数透传（`--` 后面的所有参数会原样传递给验收脚本）：**

```bash
# 自定义端口 + 单次跑
npm run smoke-test:once -- --port 3099

# 指定临时数据目录并保留 + 输出 JSON 摘要（父目录不存在会自动创建）
npm run smoke-test -- --data-dir ./tmp_acceptance --keep-data --json ./results/round1.json

# 跳过 npm install（假设依赖已装好）
npm run smoke-test -- --skip-install

# 查看完整帮助
npm run smoke-test -- --help
# 或直接用 node 调用（不需要 -- 分隔符）
node smoke.js --help
```

**统一验收脚本会自动完成以下 7 个步骤（任一步失败即硬失败并给出失败代码+原因）：**

| 步骤 | 自动执行 | 失败行为 |
|---|---|---|
| 1. 端口占用检查 | 启动前校验端口空闲，**禁止复用机器上已有服务** | 硬失败：`port_occupied`（exitCode=2），提示换 `--port` |
| 2. 依赖安装 | `server/node_modules` 不存在时自动 `npm install` | 硬失败：`install_fail`（exitCode=1），带 npm 完整错误输出 |
| 3. 数据目录 + seed | 生成临时目录 → 删旧库 → 跑 `server/src/seed.js` → 校验 DB 文件生成 | 硬失败：`seed_fail`（exitCode=3） |
| 4. 启动后端 + 健康检查 | 以自有子进程拉起（记录 PID，确认是本次拉起） → 轮询 `/api/health` 至超时 | 硬失败：`server_not_up`（exitCode=4）/ `health_timeout`（exitCode=5） |
| 5. API 冒烟测试 | admin/clerk 登录 + 14 个公开/鉴权接口全覆盖 | 硬失败：`smoke_fail`（exitCode=6），逐项列出失败项 |
| 6. 跨重启二轮验证 | 停掉首轮进程 → 换端口（默认 3001→3002，可用 `--restart-port` 改） + 换独立临时数据目录 → 再跑 1-5 步 | 硬失败：`restart_fail`（exitCode=7） |
| 7. 清理 | 自动杀进程 + 删除临时数据目录（`--keep-data` 可保留） | - |

> 脚本失败代码、原因和详细日志会写入控制台最终摘要和 `server/smoke_logs/smoke_*.log`，便于定位卡住的环节。摘要也可通过 `--json ./xxx.json` 落盘供流水线消费。

**可选参数完整列表**（`npm run smoke-test -- --help` 随时查看）：

| 参数 | 说明 |
|---|---|
| `-h, --help` | 显示完整帮助 |
| `--port <端口>` | 首轮后端端口（默认 3001） |
| `--restart-port <端口>` | 第二轮跨重启端口（默认 3002） |
| `--data-dir <目录>` | 首轮临时数据目录（默认自动生成 `server/tmp_smoke_*`） |
| `--keep-data` | 测试结束后保留临时数据目录 |
| `--json <文件>` | 把最终摘要额外写入 JSON 文件 |
| `--no-restart` | 只跑首轮，跳过跨重启二次验证 |
| `--skip-install` | 跳过 npm install（假设依赖已装） |
| `--skip-smoke` | 跳过 API 冒烟（只验 安装+seed+启动+健康） |
| `--history <N>` | 查看最近 N 次运行记录 |

### 最终摘要（对账口径，统一输出）

无论本轮是**全部通过**、**早期参数错误**（如 data-dir 指向文件）、**端口冲突**，还是运行中崩溃，结尾都会打印统一格式的「最终摘要（对账口径）」块，单看摘要就能知道本轮是怎么跑的。核心字段：

| 字段 | 说明 |
|---|---|
| `finalResult` / `failCode` / `failReason` | 本轮总体结果、失败分类和原因 |
| `command` / `argv` | 本次实际执行的命令与参数 |
| `port` / `restartPort` | 首轮端口与跨重启端口 |
| `dataDirs` | 本轮使用的所有数据目录列表 |
| `rounds[]` | 每轮明细：端口、PID、数据目录、冒烟统计、时长、失败原因 |
| `logPath` / `recordPath` / `jsonPath` | 对账路径三件套（日志、run record、JSON 摘要） |

> `--json ./path/to/file.json` 若指定的父目录不存在，会自动递归创建，无需提前 `mkdir`。

---

### 运行记录（Run Records）

每次运行验收脚本（**无论成功或失败**），都会自动在 `server/smoke_records/` 下生成一条 JSON 记录文件 `record_<timestamp>.json`，确保硬失败也不会只在控制台一闪而过。记录包含：

| 字段 | 说明 |
|---|---|
| `command` / `argv` | 完整命令和参数 |
| `install` | 是否真的执行了安装（`executed`/`skipped`/`ok`） |
| `rounds[].pid` | 每轮启动的后端进程 PID |
| `rounds[].port` | 每轮使用的端口 |
| `rounds[].healthCheck` | 健康检查结果 |
| `rounds[].seed` | seed 结果 |
| `rounds[].smoke` | 冒烟测试 passed/failed/errors 明细 |
| `failCode` / `failReason` | 失败分类和原因 |
| `logPath` | 详细日志路径 |
| `recordPath` | 本记录文件路径 |
| `dataDirs` | 本轮使用的所有数据目录 |
| `jsonPath` | 若指定 --json，JSON 摘要落盘路径 |

查看历史记录：

```bash
# 查看最近 5 次运行记录（从根目录）
npm run smoke-test -- --history 5
node smoke.js --history 5

# 或用快捷脚本（需传 -- 后跟数字）
npm run smoke-history -- 5
```

---

### 手动分步（如需要自行开发调试）

不用于验收链路；若需要手动启动前后端开发服务（**以下命令均在项目根目录执行**）：

```bash
# 1. 一次性安装三方依赖（同 smoke-test 内部）
npm run install:all

# 2. 初始化种子数据（数据库写入 server/data/app.db）
cd server && npm run seed

# 3. 启动前后端（需两个终端，或用 npm run dev 同时拉起）
# 终端 1：后端 http://localhost:3001
cd server && npm run dev
# 终端 2：前端 http://localhost:5173
cd client && npm run dev
```

登录账号：`admin / admin123`，`clerk1 / clerk123`

---

## ⏰ 时间控制与手动触发超时（核心验收场景）

系统提供 **4 种时间控制方式**，专门用于验收时模拟“确认超时”等时间相关场景。所有操作都可在 **Web 界面 → 时间控制** 页完成，或通过 REST API 调用。

### 方式 A：手动推进时间（推荐，无需管理员权限）

> 所有登录用户均可使用，适合快速验证超时。

1. 到 **系统配置** 页把 `waitlist_timeout_seconds` 改为较短值（例如 **30** 秒），或保持默认 180 秒。
2. 发放确认机会。
3. 到 **时间控制** 页，点击 **🚀 立即推进**（例如推进 200 秒 > 180 秒）。
4. 推进时间后系统会**自动执行一次过期候补扫描**，把超时的候补标记为 `expired`，并按配置自动通知下一位或停在那里。
5. 候补队列、通知日志、爽约记录、审计日志均可查到对应记录。

#### API 等价调用

```bash
# 假设 Token 已存到 $TOKEN
curl -X POST http://localhost:3001/api/time/advance \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"seconds": 200}'
```

### 方式 B：手动触发超时扫描（等价于后台定时任务）

- Web：**时间控制页 → ⏱️ 立即检查并处理过期候补**
- API：`POST /api/time/trigger-expire`

系统后台本来就每 1 秒轮询一次过期候补，但可通过此 API **立即触发一次全量扫描**。可通过配置 `manual_trigger_enabled = false` 限制仅管理员可用。

### 方式 C：设置绝对虚拟时间（需管理员）

- Web：**时间控制页 → 设置绝对时间**
- API：`POST /api/time/set { time: "2026-06-16T09:00:00", speed: 1 }`

设置后系统所有时间判断都以该虚拟时间为准。会在系统每一处展示（号源页、候补页、仪表盘）标黄显示“**⏰ 虚拟时间**”，并同时展示真实时间以便对比。

### 方式 D：设置速度倍率（1x ~ 100000x）

- Web：**时间控制页 → 速度倍率**
- API：`POST /api/time/set { speed: 100 }`

虚拟时间 = 真实时间 × 倍率。推荐搭配方式 C 先设定基准时间再加速。

### 重置为真实时间

仅管理员可用：Web 页按钮 `↩️ 重置为真实时间` 或 `POST /api/time/reset`。

---

## ✅ 验收流程参考

### 🟢 主流程：一名患者候补到确认占号

1. 登录后进入 **号源管理**，选择一个可用名额 > 0 的号源，点击“查看”。
2. 点击 **➕ 加入候补**，选择一名患者加入。
3. 此时：
   - 队列排名 #1
   - 顶部 **📣 下一位候补患者** 高亮卡提示该患者
   - **审计日志**（admin 可见）新增一条 `join_waitlist` 记录
4. 点击 **🎁 发放下一位确认机会**（或队列内对应患者的按钮）。
   - 状态变为 **待确认**（黄色闪烁徽章），显示“通知时间 / 确认截止”
   - 顶部卡片自动刷新，会指示“无下一位候补”（因为下一位被发放了）
   - **通知日志** 新增一条 `opportunity` 通知
5. 在截止时间之前，点击 **✅ 确认**。
   - 状态变为 **已确认**（绿色徽章）
   - 号源 `available_count` -1（若减到 0 状态自动变 `full`）
   - **预约管理** 中新增 / 更新对应患者的预约记录为 `confirmed`
   - **通知日志** 新增一条 `confirmed` 通知
   - 候补队列排名自动重新编号（若还有其他候补患者）

### 🔴 异常路径测试

#### 1. 同一患者重复加入候补

- 在号源详情页再次选择同一名患者点击加入。
- 系统返回错误提示：`该患者已在候补队列中，无需重复加入`（UNIQUE 约束 + 状态校验）。
- 若该患者曾是 expired/passed/cancelled，允许重新加入（进入 `rejoin_waitlist` 逻辑，审计日志中 action 不同）。
- 若该患者已是 confirmed，直接拒绝：`该患者已确认占号，无法重复加入候补`。

#### 2. 确认超时后未轮到下一人

- **关键前置**：登录 admin，进入 **系统配置**：
  - 把 `auto_recover_enabled` 改为 `false` ；或
  - 把 `recovery_strategy` 改为 `manual`。
- 发放确认机会后，到 **时间控制** 页推进时间 > 超时阈值（或点“立即检查并处理过期候补”）。
- 该候补被标记为 **expired**，但**不会**自动向新的下一位发放机会。
- 验证：
  - 下一位候补患者仍停留在 `waiting` 状态。
  - 爽约记录列表中新增一条记录。
  - 审计日志中有 `expire_waitlist` 记录。
- 若需要手动继续：手动点击下一位的 `🎁 发放机会` 即可。

#### 3. 无原因恢复爽约记录（所有角色一视同仁，无管理员例外）

- 先按上面制造一条爽约记录。
- **异常路径：任意角色空原因恢复均被拒绝**（admin / clerk 都一样）：
  - 进入 **⚠️ 爽约/恢复** 页，点击对应记录的 `↩️ 恢复`。
  - 在弹窗里留空原因、只打空格、或点取消；或从 API 传 null / 空串 / 纯空格 / 不传 reason 字段。
  - 系统统一返回 400：`恢复爽约必须提供原因`。
  - 爽约记录状态不变，预约状态不变，号源名额不变，无通知、无审计。
  - 直接 API 绕过示例（均返回 400）：
    ```bash
    curl -X POST http://localhost:3001/api/no-show-records/{id}/recover \
      -H "Authorization: Bearer {token}" -H "Content-Type: application/json" \
      -d '{"reason":""}'         # 空字符串 → 400
    curl -X POST ... -d '{"reason":"   "}'   # 纯空格 → 400
    curl -X POST ... -d '{"reason":null}'    # null → 400
    curl -X POST ... -d '{}'                 # 不传字段 → 400
    ```
- **正常路径：提供真实原因后恢复成功**：
  - 填入真实原因（前后带空格也会被自动 trim），确认。
  - 系统返回 200，`recovery_reason` 字段写入 trim 后的真实原因。
  - 审计日志新增 `recover_noshow` 记录，恢复原因即用户填写的真实原因。
- 恢复后副作用：
  - 对应预约记录变回 `confirmed`。
  - 号源 `available_count` 重新 -1（占回名额）。
  - 对应候补记录变回 `confirmed`（如有）。
  - 通知日志新增 `recovered` 通知。

#### 4. 普通 clerk 修改全局规则

- 使用 clerk1/clerk123 登录，进入 **⚙️ 系统配置**。
- 默认状态下，所有输入框均**禁用**，顶部有红色提示“当前账户无修改权限”，点保存会 403。
- 先让管理员把 `clerk_can_modify_global_config` 改为 `true`。
- 重新用 clerk1 登录：所有配置项变为可编辑，可正常保存。
- **恶意场景测试**：clerk 把自己的权限开关打开后，再试图把开关改回 `false` 是允许的（因为权限检查使用修改当时的开关值）。
- 所有修改都写入审计日志，admin 可在审计日志里看到是哪位 clerk 在何时改了什么。

---

## 📁 项目结构

```
zgw-00130/
├── package.json              # 根目录（concurrently 同时启动前后端）
├── server/                   # Express + sql.js (SQLite WASM) 后端
│   ├── package.json
│   ├── data/                 # 数据库文件目录（自动创建）
│   │   └── app.db            # SQLite 持久化数据库
│   └── src/
│       ├── index.js          # 主入口 + 所有 REST 路由（500+ 行）
│       ├── db.js             # 建表 + 默认配置
│       ├── waitlist.js       # 候补核心业务逻辑（事务、重排、过期、恢复）
│       ├── middleware.js     # JWT 认证、权限中间件
│       ├── audit.js          # 审计日志写入封装
│       ├── time.js           # 时间控制模块（虚拟时间/倍率/推进）
│       └── seed.js           # 种子数据初始化脚本
└── client/                   # React + Vite + Tailwind 前端
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx           # 路由 + 侧边栏
        ├── api.js            # axios 封装 + toast
        ├── index.css         # Tailwind + 自定义组件类
        └── pages/
            ├── Login.jsx
            ├── Dashboard.jsx     # 仪表盘 + 状态/通知徽章组件
            ├── Slots.jsx         # 号源列表
            ├── SlotDetail.jsx    # 号源详情（候补操作核心页）
            ├── Waitlist.jsx      # 全局候补队列
            ├── Notifications.jsx # 通知日志 / 患者 / 预约 / 爽约（同一文件）
            └── Config.jsx        # 配置 / 审计日志 / 时间控制（同一文件）
```

---

## 🗄️ 数据持久化说明

- 所有数据写入 **SQLite** 文件 `server/data/app.db`，包含以下表：
  - `users`：用户账号
  - `doctors` / `slots`：医生与号源
  - `patients` / `appointments`：患者与预约
  - `waitlist`：候补队列（UNIQUE(slot_id, patient_id) 防重复）
  - `notifications`：通知日志
  - `audit_logs`：审计日志（所有关键操作）
  - `no_show_records`：爽约 / 恢复记录
  - `config`：全局配置（全部持久化 + 更新者追踪）
  - `time_overrides`：虚拟时间设置（重启后仍生效）
- **删除 `server/data/app.db` 并重新执行 `npm run seed` 即可重置所有数据。**
- 服务重启后，所有队列顺序、通知记录、配置、时间模式、导出记录都保持不变。

---

## 🔌 关键 REST API

| Method | Path | 说明 | 权限 |
|---|---|---|---|
| POST | /api/auth/login | 登录拿 Token | 公开 |
| GET | /api/time | 查看时间模式与当前时间 | 公开 |
| POST | /api/time/set | 设置绝对时间/倍率（虚拟模式） | admin |
| POST | /api/time/advance | 推进 N 秒 + 触发一次过期检查 | 登录 |
| POST | /api/time/reset | 重置为真实时间 | admin |
| POST | /api/time/trigger-expire | 立即处理所有过期候补 | 登录（可配置限 admin） |
| GET / POST | /api/slots | 号源列表 / 新增号源 | 登录 / admin |
| GET | /api/slots/:id | 号源详情 + 下一位候补 | 登录 |
| PUT | /api/slots/:id/availability | 调整可用名额 | 登录 |
| GET / POST | /api/waitlist | 候补列表 / 加入候补 | 登录 |
| POST | /api/waitlist/:id/opportunity | 发放确认机会 | 登录 |
| POST | /api/waitlist/slot/:id/issue-next | 向下一位发放确认机会 | 登录 |
| POST | /api/waitlist/:id/confirm | 候补确认占号 | 登录 |
| POST | /api/waitlist/:id/pass | 过号处理 | 登录 |
| GET / POST | /api/patients | 患者查询 / 新增 | 登录 |
| GET | /api/notifications | 通知日志 | 登录 |
| GET | /api/appointments | 预约列表 | 登录 |
| POST | /api/appointments/:id/release-noshow | 标记爽约并释放号源 | 登录 |
| GET | /api/no-show-records | 爽约/恢复记录列表 | 登录 |
| POST | /api/no-show-records/:id/recover | 恢复爽约（所有角色必须提供非空真实原因） | 登录 |
| GET / PUT | /api/config | 读取 / 修改全局配置 | 登录 / 按开关限 admin |
| GET | /api/audit-logs | 审计日志 | admin 仅 |
| GET | /api/export/waitlist/:slotId | 导出候补名单 CSV（UTF-8 BOM） | 登录 |
| GET | /api/health | 健康检查 | 公开 |

---

## 🎨 界面亮点

- **号源详情页**：下一位候补患者高亮提示卡片 + 一键发放机会。
- **候补状态**：`notifying` 状态行黄底 + 徽章闪烁动画，一眼识别待确认。
- **仪表盘**：统计卡片 + 实时候补 + 最近通知，每 8 秒自动刷新。
- **时间控制**：当前时间实时刷新（1.5s），虚拟模式下对比真实时间，支持一键 `+10s / +30s / +1m / +3m / +10m / +1h` 常用推进。
- **系统配置**：9 项配置以卡片方式展示，带键名、中文描述、更新时间、修改者。

---

## 🛡️ 异常保护

| 场景 | 处理方式 |
|---|---|
| 同一患者重复加入 | UNIQUE 约束 + 状态双重校验；expired/passed 允许 rejoin |
| 确认超时时 | 双重判断：状态必须是 notifying + 当前时间必须 < deadline |
| 号源名额 | 确认占号前再查一次 available_count，并发下事务保证 |
| 配置权限 | `clerk_can_modify_global_config` 开关在中间件里动态判断 |
| 恢复原因 | 所有角色必须传非空且非纯空格的 reason，前后端双重校验，无默认兜底文案 |
| 排名错乱 | 每次变动后 `renumberWaitlist()` 统一重排，不依赖增量 |
| 手动触发权限 | 可配置 `manual_trigger_enabled` 决定 clerk 能否手动扫过期 |
| 改期冲突 | 执行前预检：患者重复 / 号源满额 / 停诊锁定 / 号源关闭 |
| 改期回滚 | 整批/单笔撤销，基于快照完整恢复预约、候补、号源名额 |
| 改期权限 | 可配置 `reschedule_clerk_can_submit` 决定办事员能否提交 |
| 跨医生改期 | 可配置 `reschedule_allow_cross_doctor` 开关控制 |
| 术前核验必填项 | 4 项核验项（化验/影像/知情/禁食）各自独立开关，`precheck_*_required` |
| 术前核验强制放行权限 | 可配置 `precheck_force_release_role` 为 admin 或 clerk |
| 术前核验重复冲突 | 导入时检查同一患者同一时段不能有两条可执行预约（pending/verified/released/force_released） |
| 术前核验状态机 | pending→verified→frozen→released→revoked，状态流转校验不允许跳步 |
| 术前核验冻结原因 | 冻结、撤销必须提供非空真实原因，前后端双重校验，无默认兜底文案 |
| 术前核验导出一致性 | 每次导出写入快照哈希（MD5），`precheck_exports` 表持久化记录方便对账 |

---

## 🏥 术前核验工作台 —— 完整主流程

### 前置条件
1. 系统中已存在 **患者预约**（`appointments` 表状态为 `booked` 或 `confirmed`）。
2. 预约对应的号源（`slots` 表）带有 `date` 日期字段。

### 主流程 9 步走

| 步骤 | 操作 | 说明 |
|---|---|---|
| 1. 登录 | 使用 `admin/admin123` 或 `clerk1/clerk123` 登录 | 侧边栏出现「🏥 术前核验」菜单 |
| 2. 选择日期 | 在工作台顶部设置「核验日期」，例如明天 `2026-06-16` | 日期默认今天 |
| 3. 预览 | 点击「👁️ 预览该日期预约」 | 弹出模态框展示该日期所有 booked/confirmed 预约的患者/医生/时段 |
| 4. 导入 | 点击「📥 按日期导入待核验」 | 系统将预约导入 `precheck_records` 表，初始状态 `pending` |
| 5. 逐项核验 | 逐条点击「编辑核验」，勾选化验/影像/知情/禁食四项，写备注后保存 | 必填项开关可在「⚙️ 规则配置」中调整 |
| 6. 材料不全时冻结 | 点击某行「冻结」→ 填写冻结原因（必填，例如「CT报告未出」）→ 确认 | 记录变 `frozen`，写入 `precheck_notifications` 冻结通知，写入审计 |
| 7. 补齐材料后放行 | 点击「放行」（普通放行）或「强放」（管理员特批） | 普通放行需所有必填核验项完成；强制放行绕过校验并写入 `force_released` 状态 |
| 8. 错误操作后撤销 | 对 `released`/`force_released` 状态的记录点击「撤销」→ 填写撤销原因 → 确认 | 状态回滚到 `revoked`，再次通知患者，全程审计 |
| 9. 导出对账 | 点击「📤 导出当前筛选」生成 CSV，到「📤 导出历史」页查看每次导出的快照哈希 | 哈希用于验证两次导出的一致性（见失败路径 3） |

### 状态流转图
```
pending ──(核验项全完成)──> verified
   │                           │
   └────────(冻结+原因)────────┘──► frozen
                                       │
                    ┌────(放行)────────┴──(强制放行)────┐
                    │                                    │
                released ──(撤销+原因)──► revoked     force_released ──(撤销+原因)──► revoked
```

### 规则配置 10 项（持久化 + 权限校验）

| 配置键 | 类型 | 默认值 | 作用 |
|---|---|---|---|
| `precheck_lab_required` | bool | true | 化验报告是否必填（影响普通放行校验） |
| `precheck_imaging_required` | bool | true | 影像检查是否必填 |
| `precheck_consent_required` | bool | true | 知情同意书是否必填 |
| `precheck_fasting_required` | bool | true | 禁食要求确认是否必填 |
| `precheck_force_release_role` | enum | admin | 允许「强制放行」的角色（admin/clerk） |
| `precheck_auto_notify_doctor_on_release` | bool | true | 放行后是否自动生成医生通知 |
| `precheck_clerk_can_import` | bool | true | 办事员是否允许按日期导入 |
| `precheck_clerk_can_freeze` | bool | true | 办事员是否允许冻结 |
| `precheck_clerk_can_release` | bool | true | 办事员是否允许普通放行 |
| `precheck_clerk_can_revoke` | bool | false | 办事员是否允许撤销放行（默认仅管理员） |

---

## 🟥 术前核验 —— 三条失败路径（验收必过）

### 失败路径 1：clerk 越权修改规则配置

**目标**：验证非 admin 用户不能修改术前核验规则，规则接口有独立的权限中间件。

**步骤**：

```bash
# 1. 先以 admin 登录，拿到管理员 Token
curl -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
# → {"token":"ADMIN_TOKEN","user":{"role":"admin"}}

# 2. 以 clerk1 登录，拿到办事员 Token
curl -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"clerk1","password":"clerk123"}'
# → {"token":"CLERK_TOKEN","user":{"role":"clerk"}}

# 3. 【关键验证】用 CLERK_TOKEN 去改规则，应返回 403
curl -X PUT http://localhost:3001/api/precheck/config \
  -H 'Authorization: Bearer CLERK_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"key":"precheck_force_release_role","value":"clerk"}'
# → 期望：403 { "error": "仅管理员可修改术前核验规则" }

# 4. 用 ADMIN_TOKEN 改规则，应成功
curl -X PUT http://localhost:3001/api/precheck/config \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"key":"precheck_force_release_role","value":"clerk"}'
# → 期望：200 { "key":"precheck_force_release_role", "old":"admin", "new":"clerk" }

# 5. 前端验证：用 clerk1 登录进入「🏥 术前核验 → ⚙️ 规则配置」页
#    所有开关和下拉框应呈禁用态（disabled），页面顶部显示红色提示「仅管理员可修改（只读）」
#    审计日志 (GET /api/audit-logs?entityType=precheck_config) 应能查到 admin 修改规则的记录
```

---

### 失败路径 2：重复放行（同患者同时段冲突检测 + 状态流转校验）

**目标**：验证系统在以下两种情况下都能阻止重复可执行预约：
- 导入时检测到同患者同时段已有可执行记录，跳过；
- 对已冻结的记录连续点击两次「放行」，第二次被拒绝。

**步骤**：

```bash
# 1. admin 登录并选定一个有预约的日期导入
curl -X POST http://localhost:3001/api/precheck/import \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-06-16"}'
# → 期望：imported=N, skipped=0

# 2. 【关键验证1】对同一个日期再次导入
curl -X POST http://localhost:3001/api/precheck/import \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-06-16"}'
# → 期望：imported=0，skipped=N。
#    理由：appointment_id 有 UNIQUE 约束，且状态非 cancelled/checked_in/frozen
#    的记录不应被重复处理。

# 3. 取第一条记录 ID（假设为 1），先把它冻住
curl -X POST http://localhost:3001/api/precheck/records/1/freeze \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"缺少血常规报告"}'
# → 期望：200，record.status = "frozen"

# 4. 把核验项补齐（四项全勾）
curl -X PUT http://localhost:3001/api/precheck/records/1/items \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"labResult":true,"imagingResult":true,"consentResult":true,"fastingResult":true}'
# → 期望：ok=true

# 5. 第一次放行，成功
curl -X POST http://localhost:3001/api/precheck/records/1/release \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{}'
# → 期望：200，record.status = "released"

# 6. 【关键验证2】对同一条记录再次放行（模拟重复点击）
curl -X POST http://localhost:3001/api/precheck/records/1/release \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{}'
# → 期望：400 { "error": "当前状态(released)不允许放行" }
#    理由：releaseRecord 中 status 必须严格等于 'frozen' 才能放行

# 7. 【关键验证3】再验证「撤销原因不能为空」
curl -X POST http://localhost:3001/api/precheck/records/1/revoke \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"reason":""}'
# → 期望：400 { "error": "撤销必须提供原因" }
```

---

### 失败路径 3：冻结后导出不一致（导出带快照哈希，两次导出对账）

**目标**：验证：
- 冻结操作会真正影响 CSV 导出内容（状态列、冻结原因列）；
- 每次导出写入带 MD5 快照哈希的 `precheck_exports` 记录，可用于对账；
- 「冻结前 → 冻结 → 冻结后」三次导出的哈希值应互不相同。

**步骤**：

```bash
# 0. 选定一个有预约的日期，提前把数据导干净
#    删除 server/data/app.db 后重新 seed：
#    rm server/data/app.db ; cd server ; npm run seed

# 1. 登录并导入该日期的预约
curl -X POST http://localhost:3001/api/precheck/import \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-06-16"}'

# 2. 【导出 #1】冻结前第一次导出，保存快照哈希
curl -D headers1.txt -o export1.csv http://localhost:3001/api/precheck/csv/export?date=2026-06-16 \
  -H 'Authorization: Bearer ADMIN_TOKEN'
HASH1=$(grep -i 'x-snapshot-hash' headers1.txt | tr -d '\r' | awk -F': ' '{print $2}')
echo "冻结前哈希 = $HASH1"
# 查一下导出历史里是否有这条：
curl http://localhost:3001/api/precheck/exports \
  -H 'Authorization: Bearer ADMIN_TOKEN'
# → list 中应有刚导出的 record_count 条，snapshot_hash 非空

# 3. 找一条记录，假设 ID 为 1，执行冻结
curl -X POST http://localhost:3001/api/precheck/records/1/freeze \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"知情同意书未签字，家属还在外地"}'

# 4. 【导出 #2】冻结后第二次导出（带 status=frozen 且有 freeze_reason）
curl -D headers2.txt -o export2.csv http://localhost:3001/api/precheck/csv/export?date=2026-06-16 \
  -H 'Authorization: Bearer ADMIN_TOKEN'
HASH2=$(grep -i 'x-snapshot-hash' headers2.txt | tr -d '\r' | awk -F': ' '{print $2}')
echo "冻结后哈希 = $HASH2"

# 5. 【关键对比】HASH1 != HASH2（因为第1行状态变了、冻结原因加了）
if [ "$HASH1" = "$HASH2" ]; then
  echo "❌ 失败：冻结前后导出哈希竟然一样，说明导出内容没随数据变化！"
else
  echo "✅ 通过：冻结前后哈希不同，导出内容反映了最新状态"
fi

# 6. 把这条记录补齐核验项并放行
curl -X PUT http://localhost:3001/api/precheck/records/1/items \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"labResult":true,"imagingResult":true,"consentResult":true,"fastingResult":true}'
curl -X POST http://localhost:3001/api/precheck/records/1/release \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"releaseNote":"材料已补齐同意书已签"}'

# 7. 【导出 #3】放行后第三次导出
curl -D headers3.txt -o export3.csv http://localhost:3001/api/precheck/csv/export?date=2026-06-16 \
  -H 'Authorization: Bearer ADMIN_TOKEN'
HASH3=$(grep -i 'x-snapshot-hash' headers3.txt | tr -d '\r' | awk -F': ' '{print $2}')
echo "放行后哈希 = $HASH3"

# 8. 【关键对比】三个哈希全不一样（pending→frozen→released，每条都有差异）
if [ "$HASH1" != "$HASH2" ] && [ "$HASH2" != "$HASH3" ] && [ "$HASH1" != "$HASH3" ]; then
  echo "✅ 全部通过：三次导出哈希互不相同，快照机制有效"
else
  echo "❌ 失败：存在两次导出哈希相同的情况，导出内容不随状态变化"
fi

# 9. 打开三份 CSV 肉眼核对：
#    export1.csv → 第1行状态=「待核验」，冻结原因=空
#    export2.csv → 第1行状态=「已冻结」，冻结原因=「知情同意书未签字...」
#    export3.csv → 第1行状态=「已放行」，放行说明=「材料已补齐同意书已签」
#    同时三份文件中「化验/影像/知情/禁食」列的值也会根据勾选状态在 export2/export3 中变化。
```

---

祝验收顺利！有任何问题请检查后端控制台输出（morgan 日志）或直接查询 `server/data/app.db`。
