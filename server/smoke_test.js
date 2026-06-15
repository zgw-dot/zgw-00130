#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const os = require('os');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname);
const SERVER_ROOT = ROOT;
const LOG_DIR = path.join(SERVER_ROOT, 'smoke_logs');
const RECORDS_DIR = path.join(SERVER_ROOT, 'smoke_records');
const DEFAULT_PORT = 3001;
const DEFAULT_HEALTH_TIMEOUT_MS = 15000;
const DEFAULT_INSTALL_TIMEOUT_MS = 120000;
const DEFAULT_SEED_TIMEOUT_MS = 30000;

function printHelp() {
  console.log(`
门诊候补号源系统 - 统一零启动验收入口

用法:
  # 推荐: 从项目根目录调用（无需切目录）
  cd zgw-00130
  npm run smoke-test -- [选项]
  npm run smoke-test:once -- [选项]
  node smoke.js [选项]

  # 或在 server/ 目录下直接调用
  cd server
  node smoke_test.js [选项]

选项:
  -h, --help                 显示此帮助
  --port <端口>              指定后端端口 (默认: 3001)
  --data-dir <目录>          指定临时数据目录 (默认: 自动生成临时目录)
                              从根目录调用时: 相对项目根目录
                              从 server/ 调用时: 相对 server/ 目录
  --keep-data                测试结束后保留数据目录
  --keep-logs                测试结束后保留日志 (默认保留)
  --no-restart               只跑单次验证, 跳过跨重启二次验证
  --restart-port <端口>       第二次重启验证用端口 (默认: 3002)
  --skip-install             跳过 npm install (假设依赖已装)
  --skip-smoke               跳过 API 冒烟测试 (只验证安装+seed+启动)
  --strict-port-check          端口占用时直接失败 (默认行为, 仅用于显式声明)
  --json <文件>             将摘要额外写入 JSON 文件
                              路径解析规则同 --data-dir
  --history <N>             查看最近 N 次运行记录

运行记录:
  每次运行（无论成功或失败）都会自动在 server/smoke_records/ 目录下生成一条
  JSON 记录文件 (record_<timestamp>.json)，包含以下信息:
    - 命令参数 (command, argv)
    - 安装状态 (install: executed/skipped/ok)
    - seed 目录与结果
    - 服务进程 PID、端口
    - 健康检查结果
    - 冒烟测试结果 (passed/failed/errors)
    - 各轮次详情 (第一轮、第二轮)
    - 失败分类 (failCode, failReason)
    - 日志路径 (logPath)
    - 运行记录路径 (recordPath)
  使用 --history <N> 可快速查看最近 N 条记录。

示例:
  npm run smoke-test
  npm run smoke-test:once -- --port 3099
  node smoke.js --data-dir ./tmp_acceptance --keep-data
  node smoke_test.js --history 5

失败代码 (exitCode):
  0  全部通过
  1  install_fail       依赖安装失败
  2  port_occupied      端口被占用 (检测到机器已有服务监听)
  3  seed_fail          seed 初始化失败
  4  server_not_up      后端未在超时时间内启动成功
  5  health_timeout     健康检查超时
  6  smoke_fail         API 冒烟测试失败
  7  restart_fail       跨重启二次验证失败
  99 unknown            未知异常
`);
}

function parseArgs(argv) {
  const args = {
    port: DEFAULT_PORT,
    dataDir: null,
    keepData: false,
    keepLogs: true,
    noRestart: false,
    restartPort: 3002,
    skipInstall: false,
    skipSmoke: false,
    strictPortCheck: true,
    json: null,
    history: null,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': args.help = true; break;
      case '--port': args.port = parseInt(argv[++i], 10); break;
      case '--data-dir': args.dataDir = argv[++i]; break;
      case '--keep-data': args.keepData = true; break;
      case '--keep-logs': args.keepLogs = true; break;
      case '--no-restart': args.noRestart = true; break;
      case '--restart-port': args.restartPort = parseInt(argv[++i], 10); break;
      case '--skip-install': args.skipInstall = true; break;
      case '--skip-smoke': args.skipSmoke = true; break;
      case '--strict-port-check': args.strictPortCheck = true; break;
      case '--json': args.json = argv[++i]; break;
      case '--history': args.history = parseInt(argv[++i], 10); break;
      default:
        console.error(`未知参数: ${a}`);
        process.exit(99);
    }
  }
  return args;
}

const FAIL = {
  INSTALL: 1,
  PORT_OCCUPIED: 2,
  SEED: 3,
  SERVER_NOT_UP: 4,
  HEALTH_TIMEOUT: 5,
  SMOKE: 6,
  RESTART: 7,
  UNKNOWN: 99,
};

function failCodeToString(code) {
  const map = {
    1: 'install_fail', 2: 'port_occupied', 3: 'seed_fail',
    4: 'server_not_up', 5: 'health_timeout', 6: 'smoke_fail',
    7: 'restart_fail', 99: 'unknown',
  };
  return map[code] || 'unknown';
}

class Logger {
  constructor(logPath) {
    this.logPath = logPath;
    this.lines = [];
    this.startedAt = Date.now();
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.stream = fs.createWriteStream(logPath, { flags: 'w' });
  }
  _ts() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  }
  info(msg) { const line = `[${this._ts()}] INFO  ${msg}`; console.log(line); this.lines.push(line); this.stream.write(line + '\n'); }
  warn(msg) { const line = `[${this._ts()}] WARN  ${msg}`; console.log(line); this.lines.push(line); this.stream.write(line + '\n'); }
  error(msg) { const line = `[${this._ts()}] ERROR ${msg}`; console.error(line); this.lines.push(line); this.stream.write(line + '\n'); }
  step(msg)  { const sep = '='.repeat(6); const line = `\n${sep} ${msg} ${sep}`; console.log(line); this.lines.push(line); this.stream.write(line + '\n'); }
  close() { try { this.stream.end(); } catch (_) {} return this.lines; }
}

function httpRequest(method, urlStr, data, token, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname, port: u.port,
      path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body || '') },
      timeout: timeoutMs || 10000,
    };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode, body: parsed, raw: text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('HTTP timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function checkPortOccupied(port) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (occupied) => {
      if (resolved) return;
      resolved = true;
      resolve(occupied);
    };

    const probe = net.createConnection({ port, host: '127.0.0.1' }, () => {
      probe.end();
      done(true);
    });
    probe.on('error', () => {
      const server = net.createServer();
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE') done(true);
        else done(false);
      });
      server.once('listening', () => {
        server.close(() => done(false));
      });
      server.listen(port, '0.0.0.0');
    });
    probe.setTimeout(1500, () => {
      try { probe.destroy(); } catch (_) {}
    });
  });
}

function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function rimraf(p) {
  try {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
    }
  } catch (_) {}
}

function npmInstall(cwd, timeoutMs, logger) {
  return new Promise((resolve, reject) => {
    logger.info(`执行 npm install (cwd=${cwd})`);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['install', '--no-audit', '--no-fund'], {
      cwd, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: process.platform === 'win32',
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} reject(new Error(`npm install 超时 (${timeoutMs}ms)`)); }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`npm install 失败 (exit=${code})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

function runSeed(dataDir, timeoutMs, logger) {
  return new Promise((resolve, reject) => {
    logger.info(`执行 seed (DATA_DIR=${dataDir})`);
    const node = process.execPath;
    const child = spawn(node, ['src/seed.js'], {
      cwd: SERVER_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATA_DIR: dataDir, DB_PATH: path.join(dataDir, 'app.db') },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} reject(new Error(`seed 超时 (${timeoutMs}ms)`)); }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`seed 失败 (exit=${code})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

function startServer(port, dataDir, logger) {
  const node = process.execPath;
  const dbPath = path.join(dataDir, 'app.db');
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, DB_PATH: dbPath };
  const child = spawn(node, ['src/index.js'], {
    cwd: SERVER_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    detached: false,
  });
  return child;
}

function waitForHealth(port, timeoutMs, logger) {
  const start = Date.now();
  const url = `http://127.0.0.1:${port}/api/health`;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs) {
        reject(new Error(`健康检查超时 (${timeoutMs}ms)`));
        return;
      }
      httpRequest('GET', url, null, null, 2000).then(
        (r) => {
          if (r.status === 200 && r.body && r.body.status === 'ok') resolve(r);
          else setTimeout(tick, 500);
        },
        () => setTimeout(tick, 500),
      );
    };
    tick();
  });
}

function killProcessTree(child, logger, label) {
  return new Promise((resolve) => {
    const pid = child.pid;
    logger.info(`${label || ''}终止进程 PID=${pid}`);
    if (!pid || child.killed) { resolve(); return; }
    let settled = false;
    const forceTimer = setTimeout(() => {
      if (settled) return;
      try {
        if (process.platform === 'win32') {
          try { execSync('taskkill /F /T /PID ' + pid + ' 2>$null'); } catch (_) {}
        } else {
          try { process.kill(-pid, 'SIGKILL'); } catch (_) {}
          try { child.kill('SIGKILL'); } catch (_) {}
        }
      } catch (_) {}
    }, 3000);
    child.once('exit', () => { settled = true; clearTimeout(forceTimer); resolve(); });
    try { child.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => { settled = true; clearTimeout(forceTimer); resolve(); }, 5000);
  });
}

async function smokeApiSmoke(port, logger) {
  const BASE = `http://127.0.0.1:${port}/api`;
  const result = { passed: 0, failed: 0, errors: [] };
  const assert = (cond, msg) => {
    if (cond) { result.passed++; logger.info(`  PASS  ${msg}`); }
    else { result.failed++; logger.error(`  FAIL  ${msg}`); result.errors.push(msg); }
  };

  const loginAdmin = await httpRequest('POST', `${BASE}/auth/login`, { username: 'admin', password: 'admin123' });
  assert(loginAdmin.status === 200, `admin 登录 200 (实际${loginAdmin.status})`);
  const adminToken = loginAdmin.body && loginAdmin.body.token;
  assert(!!adminToken, '获取 admin token');

  const loginClerk = await httpRequest('POST', `${BASE}/auth/login`, { username: 'clerk1', password: 'clerk123' });
  assert(loginClerk.status === 200, `clerk1 登录 200 (实际${loginClerk.status})`);
  const clerkToken = loginClerk.body && loginClerk.body.token;
  assert(!!clerkToken, '获取 clerk1 token');

  const me = await httpRequest('GET', `${BASE}/auth/me`, null, adminToken);
  assert(me.status === 200, '/auth/me 200');
  assert(me.body && me.body.user && me.body.user.role === 'admin', 'auth/me 返回 admin 角色');

  const doctors = await httpRequest('GET', `${BASE}/doctors`, null, adminToken);
  assert(doctors.status === 200, '/doctors 200');
  assert(doctors.body && Array.isArray(doctors.body.list) && doctors.body.list.length >= 5, `医生数据 >=5 (实际 ${doctors.body && doctors.body.list ? doctors.body.list.length : 0})`);

  const slots = await httpRequest('GET', `${BASE}/slots`, null, adminToken);
  assert(slots.status === 200, '/slots 200');
  assert(slots.body && Array.isArray(slots.body.list) && slots.body.list.length >= 1, '号源数据非空');

  const patients = await httpRequest('GET', `${BASE}/patients`, null, adminToken);
  assert(patients.status === 200, '/patients 200');
  assert(patients.body && Array.isArray(patients.body.list) && patients.body.list.length >= 8, `患者数据 >=8`);

  const waitlist = await httpRequest('GET', `${BASE}/waitlist`, null, adminToken);
  assert(waitlist.status === 200, '/waitlist 200');

  const config = await httpRequest('GET', `${BASE}/config`, null, adminToken);
  assert(config.status === 200, '/config 200');
  assert(config.body && config.body.config, 'config 返回配置对象');

  const timeRoute = await httpRequest('GET', `${BASE}/time`);
  assert(timeRoute.status === 200, '/time 公开 200');
  assert(timeRoute.body && 'currentTime' in timeRoute.body, '/time 返回时间字段');

  const notifications = await httpRequest('GET', `${BASE}/notifications`, null, adminToken);
  assert(notifications.status === 200, '/notifications 200');

  const appointments = await httpRequest('GET', `${BASE}/appointments`, null, adminToken);
  assert(appointments.status === 200, '/appointments 200');

  const noShow = await httpRequest('GET', `${BASE}/no-show-records`, null, adminToken);
  assert(noShow.status === 200, '/no-show-records 200');

  const audit = await httpRequest('GET', `${BASE}/audit-logs`, null, adminToken);
  assert(audit.status === 200, `审计日志 200 (admin 可见)`);
  assert(audit.body && Array.isArray(audit.body.list), '审计返回数组');

  const clerkConfig = await httpRequest('GET', `${BASE}/config`, null, clerkToken);
  assert(clerkConfig.status === 200, 'clerk 可读 config');

  return result;
}

async function runOneRound(opts, logger, roundLabel) {
  const {
    port, dataDir, keepData, skipInstall, skipSmoke, strictPortCheck,
    installTimeoutMs, seedTimeoutMs, healthTimeoutMs,
  } = opts;

  const summary = {
    round: roundLabel,
    port,
    dataDir,
    steps: {},
    startedAt: Date.now(),
    endedAt: null,
    ok: false,
    failCode: 0,
    failReason: null,
    child: null,
    dbPath: path.join(dataDir, 'app.db'),
  };

  logger.step(`第${roundLabel}轮开始: port=${port}, dataDir=${dataDir}`);

  // ========= Step 0: 端口占用检查
  logger.step('Step 1/5: 端口占用检查');
  const occupied = await checkPortOccupied(port);
  summary.steps.port_check = { ok: !occupied, duration: 0 };
  if (occupied) {
    if (strictPortCheck) {
      logger.error(`端口 ${port} 已被占用。本脚本不允许复用机器上已在跑的服务，请先停掉再跑，或换 --port 指定其他端口`);
      summary.failCode = FAIL.PORT_OCCUPIED;
      summary.failReason = `端口 ${port} 被占用`;
      summary.endedAt = Date.now();
      return summary;
    }
  }
  logger.info(`端口 ${port} 可用`);

  // ========= Step 1: 依赖安装
  logger.step('Step 2/5: 依赖安装检查');
  const needRoot = path.join(SERVER_ROOT, 'node_modules');
  let installOk = true;
  if (!skipInstall) {
    if (!dirExists(needRoot)) {
      try {
        await npmInstall(SERVER_ROOT, installTimeoutMs, logger);
        summary.steps.install = { ok: true, duration: 0 };
      } catch (e) {
          logger.error(`依赖安装失败: ${e.message}`);
          summary.failCode = FAIL.INSTALL; summary.failReason = `npm install 失败: ${e.message}`;
          summary.endedAt = Date.now();
          return summary;
        }
    } else {
      logger.info(`检测到 node_modules 已存在，跳过安装 (--skip-install 可显式跳过)`);
      summary.steps.install = { ok: true, skipped: true };
    }
  } else {
      logger.info(`用户指定 --skip-install`);
      summary.steps.install = { ok: true, skipped: true };
  }

  // ========= Step 2: 准备数据目录 + seed
  logger.step('Step 3/5: 数据目录 + seed');
  try {
    if (!dirExists(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dbP = path.join(dataDir, 'app.db');
    if (fileExists(dbP)) {
      logger.warn(`数据目录已存在数据库文件，将删除重建以保证干净状态`);
      fs.unlinkSync(dbP);
    }
  } catch (e) {
    logger.error(`清理旧数据清理失败: ${e.message}`);
  }
  try {
    await runSeed(dataDir, seedTimeoutMs, logger);
    summary.steps.seed = { ok: true };
    const dbExists = fileExists(path.join(dataDir, 'app.db'));
    if (!dbExists) throw new Error('seed 完成但数据库文件不存在');
    logger.info(`seed 成功，数据库文件已生成`);
  } catch (e) {
    logger.error(`seed 失败: ${e.message}`);
    summary.failCode = FAIL.SEED; summary.failReason = `seed 失败: ${e.message}`;
    summary.endedAt = Date.now();
    return summary;
  }

  // ========= Step 3: 启动服务 + 等待健康检查
  logger.step('Step 4/5: 启动后端服务 + 健康检查');
  let serverChild = null;
  let serverStdout = '', serverStderr = '';
  try {
    serverChild = startServer(port, dataDir, logger);
    summary.child = serverChild;
    serverChild.stdout.on('data', (d) => { const s = d.toString(); serverStdout += s; if (s.trim()) logger.info(`[后端stdout] ${s.trim()}`); });
    serverChild.stderr.on('data', (d) => { const s = d.toString(); serverStderr += s; if (s.trim()) logger.error(`[后端stderr] ${s.trim()}`); });
    let serverExitedPrematurely = false;
    serverChild.once('exit', (code) => {
      if (code != null && code !== 0) {
        serverExitedPrematurely = true;
        logger.error(`后端进程异常退出 exit=${code}`);
      }
    });
    try {
      await waitForHealth(port, healthTimeoutMs, logger);
    } catch (e) {
      if (serverExitedPrematurely) {
        logger.error(`后端进程在启动过程中退出，启动日志:\n${serverStdout}\n${serverStderr}`);
        summary.failCode = FAIL.SERVER_NOT_UP; summary.failReason = `后端启动失败并退出: ${e.message}`;
        await killProcessTree(serverChild, logger, '启动失败清理');
        summary.endedAt = Date.now();
        return summary;
      }
      logger.error(`健康检查超时: ${e.message}`);
      summary.failCode = FAIL.HEALTH_TIMEOUT; summary.failReason = `健康检查超时 (${healthTimeoutMs}ms): ${e.message}`;
      await killProcessTree(serverChild, logger, '健康检查超时清理');
      summary.endedAt = Date.now();
      return summary;
    }
    logger.info(`健康检查通过，服务 PID=${serverChild.pid}，端口 ${port}`);
    summary.steps.server_start = { ok: true, pid: serverChild.pid };

    // 二次验证：确认这个端口的服务确实是我们刚拉起的（对比启动输出里是否包含我们的标识）
    const startupBanner = /门诊候补号源|后端服务已启动/i.test(serverStdout);
    if (startupBanner) logger.info(`已确认服务为本次验收拉起的服务（启动标识匹配）`);
    else logger.warn(`未在启动输出中匹配到启动标识，但健康检查通过仍可响应`);

  } catch (e) {
    logger.error(`启动阶段异常: ${e.message}`);
    summary.failCode = FAIL.SERVER_NOT_UP; summary.failReason = `启动阶段异常: ${e.message}`;
    if (serverChild) await killProcessTree(serverChild, logger, '异常清理');
    summary.endedAt = Date.now();
    return summary;
  }

  // ========= Step 4: API 冒烟
  let smokeResult = null;
  if (!skipSmoke) {
    logger.step('Step 5/5: API 冒烟测试');
    try {
      smokeResult = await smokeApiSmoke(port, logger);
      summary.steps.smoke = smokeResult;
      if (smokeResult.failed > 0) {
        logger.error(`冒烟测试失败 ${smokeResult.failed} 项`);
        summary.failCode = FAIL.SMOKE; summary.failReason = `冒烟测试失败 ${smokeResult.failed} 项: ${smokeResult.errors.join('; ')}`;
        await killProcessTree(serverChild, logger, '冒烟失败后清理');
        summary.endedAt = Date.now();
        return summary;
      }
      logger.info(`冒烟通过 ${smokeResult.passed} 项全部通过`);
    } catch (e) {
      logger.error(`冒烟测试异常: ${e.message}`);
      summary.failCode = FAIL.SMOKE; summary.failReason = `冒烟测试异常: ${e.message}`;
      await killProcessTree(serverChild, logger, '冒烟异常清理');
      summary.endedAt = Date.now();
      return summary;
    }
  } else {
    logger.info(`--skip-smoke 指定，跳过冒烟`);
    summary.steps.smoke = { skipped: true };
  }

  // ========= 全部通过
  summary.ok = true;
  summary.endedAt = Date.now();
  logger.step(`第${roundLabel}轮全部通过 ✓`);
  return summary;
}

function writeRunRecord(stamp, logPath, finalSummary) {
  try {
    if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true });
    const recordId = `record_${stamp}`;
    const recordPath = path.join(RECORDS_DIR, `${recordId}.json`);

    const firstRoundSteps = finalSummary.rounds.length > 0 ? finalSummary.rounds[0].steps : {};
    const installStep = firstRoundSteps.install || {};
    let installRecord;
    if (finalSummary.rounds.length > 0 && finalSummary.rounds[0].failCode === FAIL.INSTALL) {
      installRecord = { executed: true, skipped: false, ok: false };
    } else if (installStep.skipped) {
      installRecord = { executed: false, skipped: true, ok: !!installStep.ok };
    } else if (Object.keys(installStep).length > 0) {
      installRecord = { executed: true, skipped: false, ok: !!installStep.ok };
    } else {
      installRecord = { executed: false, skipped: false, ok: false };
    }

    const recordRounds = finalSummary.rounds.map(r => {
      const steps = r.steps || {};
      const serverStart = steps.server_start || {};
      const seedStep = steps.seed || null;
      const smokeStep = steps.smoke || null;
      let healthCheck = null;
      if (serverStart.ok) {
        healthCheck = { ok: true };
      } else if (r.failCode === FAIL.HEALTH_TIMEOUT) {
        healthCheck = { ok: false };
      }

      return {
        label: r.label,
        port: r.port,
        dataDir: r.dataDir,
        ok: r.ok,
        failCode: r.failCode,
        failReason: r.failReason,
        durationMs: r.duration,
        pid: serverStart.pid || null,
        healthCheck,
        seed: seedStep,
        smoke: smokeStep,
        steps,
      };
    });

    const exitCode = finalSummary.failCode || 0;
    const record = {
      id: recordId,
      timestamp: finalSummary.startedAt,
      timestampISO: new Date(finalSummary.startedAt).toISOString(),
      command: `node smoke_test.js ${process.argv.slice(2).join(' ')}`,
      argv: process.argv.slice(2),
      exitCode,
      finalResult: finalSummary.finalResult,
      failCode: finalSummary.failCode,
      failReason: finalSummary.failReason,
      durationMs: finalSummary.endedAt - finalSummary.startedAt,
      logPath,
      recordPath,
      install: installRecord,
      rounds: recordRounds,
    };

    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
    return recordPath;
  } catch (e) {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }

  if (args.history) {
    const n = args.history;
    if (isNaN(n) || n <= 0) {
      console.error('--history 需要正整数参数');
      process.exit(99);
    }
    if (!fs.existsSync(RECORDS_DIR)) {
      console.log('暂无运行记录');
      process.exit(0);
    }
    const files = fs.readdirSync(RECORDS_DIR)
      .filter(f => f.startsWith('record_') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length === 0) {
      console.log('暂无运行记录');
      process.exit(0);
    }
    const selected = files.slice(0, n);
    console.log(`\n最近 ${n} 次运行记录 (共 ${files.length} 条):\n`);
    for (const f of selected) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(RECORDS_DIR, f), 'utf8'));
        const ts = data.timestampISO || data.id.replace('record_', '');
        const resultStr = data.finalResult === 'pass' || data.finalResult === 'pass_round1_only'
          ? '✅ PASS'
          : `❌ FAIL (${failCodeToString(data.failCode)})`;
        const cmd = data.command || '';
        const port = data.rounds && data.rounds[0] ? data.rounds[0].port : (data.port || '-');
        const dur = data.durationMs ? `${(data.durationMs / 1000).toFixed(1)}s` : 'n/a';
        console.log(`  ${ts}  ${resultStr}  端口=${port}  时长=${dur}  命令=${cmd}`);
      } catch (_) {
        console.log(`  [无法读取: ${f}]`);
      }
    }
    console.log('');
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `smoke_${stamp}.log`);
  const logger = new Logger(logPath);

  logger.info(`门诊候补号源系统 - 零启动验收入口`);
  logger.info(`日志文件: ${logPath}`);

  const finalSummary = {
    startedAt: Date.now(),
    rounds: [],
    tempDirs: [],
    finalResult: 'pending',
    failCode: 0,
    failReason: null,
    logPath,
    port: args.port,
    restartPort: args.restartPort,
  };

  const round1DataDir = args.dataDir
    ? (path.isAbsolute(args.dataDir) ? args.dataDir : path.resolve(SERVER_ROOT, args.dataDir))
    : path.join(SERVER_ROOT, `tmp_smoke_${process.pid}_1`);
  finalSummary.tempDirs.push(round1DataDir);

  const round1Opts = {
    port: args.port,
    dataDir: round1DataDir,
    keepData: args.keepData,
    skipInstall: args.skipInstall,
    skipSmoke: args.skipSmoke,
    strictPortCheck: args.strictPortCheck,
    installTimeoutMs: DEFAULT_INSTALL_TIMEOUT_MS,
    seedTimeoutMs: DEFAULT_SEED_TIMEOUT_MS,
    healthTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
  };

  const r1 = await runOneRound(round1Opts, logger, '一');
  finalSummary.rounds.push({
    label: '第一轮（首次启动）',
    port: r1.port,
    dataDir: r1.dataDir,
    ok: r1.ok,
    failCode: r1.failCode,
    failReason: r1.failReason,
    duration: r1.endedAt ? r1.endedAt - r1.startedAt : null,
    steps: r1.steps,
  });

  // 清理第一轮进程
  if (r1.child) {
    await killProcessTree(r1.child, logger, '第一轮进程清理');
    r1.child = null;
  }

  if (!r1.ok) {
    finalSummary.finalResult = 'fail_round1';
    finalSummary.failCode = r1.failCode;
    finalSummary.failReason = `第一轮失败: ${r1.failReason}`;
  } else if (!args.noRestart) {
    // ========== 跨重启第二轮 ==========
    logger.step('跨重启二次验证启动');
    const round2DataDir = args.dataDir && !args.keepData
      ? (path.isAbsolute(args.dataDir + '_2')
        ? args.dataDir + '_2'
        : path.resolve(SERVER_ROOT, args.dataDir + '_2'))
      : path.join(SERVER_ROOT, `tmp_smoke_${process.pid}_2`);
    finalSummary.tempDirs.push(round2DataDir);

    // 如果用户没指定 --data-dir 并且没指定 --keep-data，第二轮强制用不同端口和独立数据目录
    const round2Port = args.port === args.restartPort ? args.restartPort + 1 : args.restartPort;

    const round2Opts = {
      port: round2Port,
      dataDir: round2DataDir,
      keepData: args.keepData,
      skipInstall: true,
      skipSmoke: args.skipSmoke,
      strictPortCheck: args.strictPortCheck,
      installTimeoutMs: DEFAULT_INSTALL_TIMEOUT_MS,
      seedTimeoutMs: DEFAULT_SEED_TIMEOUT_MS,
      healthTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    };

    const r2 = await runOneRound(round2Opts, logger, '二');
    finalSummary.rounds.push({
      label: '第二轮（跨重启验证）',
      port: r2.port,
      dataDir: r2.dataDir,
      ok: r2.ok,
      failCode: r2.failCode,
      failReason: r2.failReason,
      duration: r2.endedAt ? r2.endedAt - r2.startedAt : null,
      steps: r2.steps,
    });

    if (r2.child) {
      await killProcessTree(r2.child, logger, '第二轮进程清理');
    }

    if (!r2.ok) {
      finalSummary.finalResult = 'fail_round2';
      finalSummary.failCode = FAIL.RESTART;
      finalSummary.failReason = `第二轮跨重启验证失败: ${r2.failReason}`;
    } else {
      finalSummary.finalResult = 'pass';
      logger.step('两轮全部通过 ✓✓');
    }
  } else {
    finalSummary.finalResult = 'pass_round1_only';
  }

  // ========== 清理临时目录 ==========
  if (!args.keepData) {
    for (const d of finalSummary.tempDirs) {
      if (dirExists(d)) {
        try {
          rimraf(d);
          logger.info(`已清理临时数据目录: ${d}`);
        } catch (e) {
          logger.warn(`清理临时目录失败: ${d}, 原因: ${e.message}`);
        }
      }
    }
  } else {
    logger.info(`--keep-data 指定，保留数据目录: ${finalSummary.tempDirs.join(', ')}`);
  }

  // ========== 最终摘要 ==========
  finalSummary.endedAt = Date.now();
  logger.step('最终摘要');
  logger.info(`结果: ${finalSummary.finalResult === 'pass' || finalSummary.finalResult === 'pass_round1_only' ? '✅ 全部通过' : '❌ 失败'}`);
  logger.info(`日志文件: ${logPath}`);
  for (const r of finalSummary.rounds) {
    const icon = r.ok ? '✅' : '❌';
    logger.info(`${icon} ${r.label} 端口=${r.port} 数据=${r.dataDir} 时长=${r.duration ? (r.duration / 1000).toFixed(1) + 's' : 'n/a'} 结果=${r.ok ? 'PASS' : 'FAIL:' + failCodeToString(r.failCode) + (r.failReason ? ' - ' + r.failReason : '')}`);
  }

  if (finalSummary.failCode !== 0) {
    logger.error(`失败分类: ${failCodeToString(finalSummary.failCode)}`);
    logger.error(`失败原因: ${finalSummary.failReason}`);
  }

  // ========== 写入运行记录 ==========
  const recordPath = writeRunRecord(stamp, logPath, finalSummary);
  if (recordPath) {
    logger.info(`运行记录: ${recordPath}`);
  }

  if (args.json) {
    try {
      const jsonPath = path.isAbsolute(args.json) ? args.json : path.resolve(SERVER_ROOT, args.json);
      fs.writeFileSync(jsonPath, JSON.stringify(finalSummary, null, 2));
      logger.info(`摘要 JSON 已写入: ${jsonPath}`);
    } catch (e) {
      logger.error(`写入 JSON 摘要失败: ${e.message}`);
    }
  }

  logger.close();
  process.exit(finalSummary.failCode || 0);
}

main().catch((e) => {
  console.error(`[致命] 顶层异常:`, e && e.stack ? e.stack : e);
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const recDir = path.join(__dirname, 'smoke_records');
    if (!fs.existsSync(recDir)) fs.mkdirSync(recDir, { recursive: true });
    const recPath = path.join(recDir, `record_${ts}.json`);
    fs.writeFileSync(recPath, JSON.stringify({
      id: `record_${ts}`,
      timestamp: Date.now(),
      timestampISO: new Date().toISOString(),
      command: `node smoke_test.js ${process.argv.slice(2).join(' ')}`,
      argv: process.argv.slice(2),
      exitCode: FAIL.UNKNOWN,
      finalResult: 'fatal_error',
      failCode: FAIL.UNKNOWN,
      failReason: e && e.message ? e.message : String(e),
      durationMs: 0,
      logPath: null,
      recordPath: recPath,
      install: { executed: false, skipped: false, ok: false },
      rounds: [],
    }, null, 2));
  } catch (_) {}
  process.exit(FAIL.UNKNOWN);
});
