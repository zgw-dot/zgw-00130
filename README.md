# 门诊候补号源与爽约恢复系统

一个可本地验证的、前后端分离的门诊候补号源管理系统，支持候补队列、发放确认机会、确认、过号、爽约释放、管理员手动恢复等完整流程。使用 **Express + SQLite + React + Vite + TailwindCSS** 构建，所有数据持久化到本地文件 `server/data/app.db`，服务重启后结果不变。

---

## 功能总览

| 模块 | 功能 |
|---|---|
| 🔐 认证 | 管理员/办事员两种角色，JWT Token 登录 |
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

## 快速开始

### 1. 安装依赖

```bash
# 先进入项目根目录
cd zgw-00130

# 方式一（推荐）：一键安装所有依赖
npm run install:all

# 方式二：手动分步
npm install
cd server && npm install
cd ../client && npm install
```

> 注意：项目使用 `sql.js`（SQLite WASM），无需原生编译环境（不依赖 Visual Studio Build Tools、Python 或 node-gyp），在 Windows / macOS / Linux 上直接 `npm install` 即可。

### 2. 初始化种子数据

```bash
cd server
npm run seed
```

种子数据会创建：

- **用户**：admin / admin123（管理员），clerk1 / clerk123，clerk2 / clerk123（办事员）
- **医生**：5 名（内科、外科、儿科、妇产科、眼科）
- **号源**：今明两天共 8 个号源（含已约满的、有剩余名额的各种情况）
- **患者**：8 名示例患者
- **预约**：8 条示例预约记录
- **配置**：9 条默认全局配置

### 3. 启动服务

```bash
# 方式一（推荐）：同时启动前后端
cd ..   # 回到项目根
npm run dev

# 方式二：分别启动
# 终端 1：后端（端口 3001）
cd server && npm run dev
# 终端 2：前端（端口 5173）
cd client && npm run dev
```

- 后端 API：http://localhost:3001
- 前端界面：http://localhost:5173
- 健康检查：http://localhost:3001/api/health

### 4. 登录

打开 http://localhost:5173，使用 `admin / admin123` 或 `clerk1 / clerk123` 登录。

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

---

祝验收顺利！有任何问题请检查后端控制台输出（morgan 日志）或直接查询 `server/data/app.db`。
