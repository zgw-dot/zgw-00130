const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const TEST_PORT = parseInt(process.env.TEST_PORT || '3199', 10);
const DATA_DIR = path.join(__dirname, 'data_test_precheck_csv');
const DB_PATH = path.join(DATA_DIR, 'app.db');

let serverProcess = null;
let serverPid = null;
let adminToken = null;
let testPassed = 0;
let testFailed = 0;
let testErrors = [];

const log = (msg, type = 'info') => {
  const prefix = type === 'pass' ? '✅' : type === 'fail' ? '❌' : type === 'warn' ? '⚠️' : type === 'step' ? '🔹' : 'ℹ️';
  console.log(`${prefix} ${msg}`);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function assert(condition, testName, detail = '') {
  if (condition) {
    testPassed++;
    log(`PASS: ${testName}`, 'pass');
  } else {
    testFailed++;
    const msg = detail ? `${testName} - ${detail}` : testName;
    testErrors.push(msg);
    log(`FAIL: ${msg}`, 'fail');
  }
}

function buildCsv(rows) {
  const header = '预约ID';
  const lines = [header];
  rows.forEach(r => lines.push(String(r)));
  return '\uFEFF' + lines.join('\n');
}

function httpRequest(method, urlPath, data, token) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body || '')
      },
      timeout: 10000
    };
    if (token) opts.headers.Authorization = 'Bearer ' + token;

    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode, body: parsed, raw: text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('HTTP timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function runServiceLayerTests() {
  log('========================================', 'step');
  log('第一部分：服务层测试（直接调用 precheckCsv）');
  log('========================================', 'step');

  process.env.DATA_DIR = DATA_DIR;
  process.env.DB_PATH = DB_PATH;

  const db = require('./src/db');
  const precheckCsv = require('./src/precheckCsv');

  await db.ready;
  db.initTables();

  log('准备服务层测试数据...', 'step');

  const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  const bcrypt = require('bcryptjs');
  insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'admin');

  const insertPatient = db.prepare('INSERT INTO patients (name, phone, id_card) VALUES (?, ?, ?)');
  const p1 = insertPatient.run('服务层患者A', '13910000001', '110101199001011001');
  const patientIdA = p1.lastInsertRowid;
  const p2 = insertPatient.run('服务层患者B', '13910000002', '110101199001011002');
  const patientIdB = p2.lastInsertRowid;

  const insertDoctor = db.prepare('INSERT INTO doctors (name, department, title) VALUES (?, ?, ?)');
  const d1 = insertDoctor.run('服务层医生甲', '外科', '主任医师');
  const doctorId1 = d1.lastInsertRowid;
  const d2 = insertDoctor.run('服务层医生乙', '外科', '副主任医师');
  const doctorId2 = d2.lastInsertRowid;

  const insertRoom = db.prepare('INSERT INTO rooms (name, location, status) VALUES (?, ?, ?)');
  const r1 = insertRoom.run('S诊室1', 'S楼1层', 'active');
  const roomId1 = r1.lastInsertRowid;
  const r2 = insertRoom.run('S诊室2', 'S楼2层', 'active');
  const roomId2 = r2.lastInsertRowid;

  const testDate = '2026-07-15';
  const insertSlot = db.prepare(`
    INSERT INTO slots (doctor_id, room_id, date, period, time_start, time_end, capacity, available_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const s1 = insertSlot.run(doctorId1, roomId1, testDate, 'morning', '08:00', '12:00', 10, 5, 'active');
  const slotMorning1 = s1.lastInsertRowid;

  const s2 = insertSlot.run(doctorId2, roomId2, testDate, 'morning', '09:00', '11:30', 8, 3, 'active');
  const slotMorning2 = s2.lastInsertRowid;

  const s3 = insertSlot.run(doctorId1, roomId1, testDate, 'afternoon', '14:00', '17:30', 10, 5, 'active');
  const slotAfternoon1 = s3.lastInsertRowid;

  const s4 = insertSlot.run(doctorId2, roomId2, testDate, 'afternoon', '14:30', '17:00', 8, 3, 'active');
  const slotAfternoon2 = s4.lastInsertRowid;

  const insertAppt = db.prepare('INSERT INTO appointments (slot_id, patient_id, status) VALUES (?, ?, ?)');

  const a1 = insertAppt.run(slotMorning1, patientIdA, 'booked');
  const apptMorning1 = a1.lastInsertRowid;

  const a2 = insertAppt.run(slotMorning2, patientIdA, 'booked');
  const apptMorning2 = a2.lastInsertRowid;

  const a3 = insertAppt.run(slotAfternoon1, patientIdA, 'booked');
  const apptAfternoon1 = a3.lastInsertRowid;

  const a4 = insertAppt.run(slotAfternoon2, patientIdB, 'booked');
  const apptAfternoon2 = a4.lastInsertRowid;

  const a5 = insertAppt.run(slotMorning1, patientIdA, 'cancelled');
  const apptCancelled = a5.lastInsertRowid;

  db.forceSave();

  log(`测试数据已创建: 患者2人, 医生2人, 号源4个, 预约5个`);
  log(`  - 上午号源1 (患者A): apptId=${apptMorning1}`);
  log(`  - 上午号源2 (患者A): apptId=${apptMorning2}`);
  log(`  - 下午号源1 (患者A): apptId=${apptAfternoon1}`);
  log(`  - 下午号源2 (患者B): apptId=${apptAfternoon2}`);
  log(`  - 已取消预约 (患者A): apptId=${apptCancelled}`);

  const mockReq = {
    user: { id: 1, username: 'admin', role: 'admin' },
    headers: {},
    ip: '127.0.0.1'
  };

  const recordCountBefore = db.prepare('SELECT COUNT(*) as cnt FROM precheck_records').get().cnt;
  log(`测试前 precheck_records 数量: ${recordCountBefore}`);

  log('--- Test 1: 空 CSV ---', 'step');
  {
    const result = precheckCsv.importFromCsv(mockReq, '');
    assert(result.parsed === 0, 'parsed = 0', `实际: ${result.parsed}`);
    assert(result.validCount === 0, 'validCount = 0', `实际: ${result.validCount}`);
    assert(Array.isArray(result.invalid) && result.invalid.length === 0, 'invalid 数组为空', `实际长度: ${result.invalid?.length}`);
    assert(result.imported === 0, 'imported = 0', `实际: ${result.imported}`);
    assert(result.skipped === 0, 'skipped = 0', `实际: ${result.skipped}`);
    assert(Array.isArray(result.conflicts) && result.conflicts.length === 0, 'conflicts 数组为空', `实际长度: ${result.conflicts?.length}`);
    assert(result.message === 'CSV 为空', 'message = "CSV 为空"', `实际: ${result.message}`);
  }

  log('--- Test 2: 无效预约 ID (非数字字符串) ---', 'step');
  {
    const csv = buildCsv(['abc', 'xyz']);
    const result = precheckCsv.importFromCsv(mockReq, csv);
    assert(result.parsed === 2, 'parsed = 2', `实际: ${result.parsed}`);
    assert(result.validCount === 0, 'validCount = 0', `实际: ${result.validCount}`);
    assert(result.invalid.length === 2, 'invalid 有 2 条', `实际: ${result.invalid.length}`);
    assert(result.invalid[0].error === '预约ID无效', '错误信息为 "预约ID无效"', `实际: ${result.invalid[0]?.error}`);
    assert(result.imported === 0, 'imported = 0', `实际: ${result.imported}`);
    assert(result.skipped === 0, 'skipped = 0', `实际: ${result.skipped}`);
    assert(result.conflicts.length === 0, 'conflicts 为空', `实际长度: ${result.conflicts.length}`);
    assert(result.message === 'CSV 中没有有效的预约ID', 'message 正确', `实际: ${result.message}`);
  }

  log('--- Test 3: 只有 header 没有数据行 ---', 'step');
  {
    const csv = '预约ID\n';
    const result = precheckCsv.importFromCsv(mockReq, csv);
    assert(result.parsed === 0, 'parsed = 0', `实际: ${result.parsed}`);
    assert(result.validCount === 0, 'validCount = 0', `实际: ${result.validCount}`);
    assert(Array.isArray(result.invalid) && result.invalid.length === 0, 'invalid 数组为空', `实际长度: ${result.invalid?.length}`);
    assert(result.imported === 0, 'imported = 0', `实际: ${result.imported}`);
    assert(result.skipped === 0, 'skipped = 0', `实际: ${result.skipped}`);
    assert(Array.isArray(result.conflicts) && result.conflicts.length === 0, 'conflicts 为空', `实际长度: ${result.conflicts?.length}`);
    assert(result.message === 'CSV 为空', 'message = "CSV 为空"', `实际: ${result.message}`);
  }

  log('--- Test 4: 预约 ID 查不到（不存在的 ID）---', 'step');
  {
    const nonExistentId1 = 99999;
    const nonExistentId2 = 88888;
    const csv = buildCsv([nonExistentId1, nonExistentId2]);
    const result = precheckCsv.importFromCsv(mockReq, csv);

    assert(result.parsed === 2, 'parsed = 2', `实际: ${result.parsed}`);
    assert(result.validCount === 0, 'validCount = 0 (查不到的不算有效)', `实际: ${result.validCount}`);
    assert(result.invalid.length === 2, 'invalid 有 2 条 (查不到的也算无效)', `实际: ${result.invalid.length}`);
    assert(result.invalid[0].error.includes('不存在'), '错误信息包含"不存在"', `实际: ${result.invalid[0]?.error}`);
    assert(result.invalid[1].error.includes('不存在'), '第二条错误也包含"不存在"', `实际: ${result.invalid[1]?.error}`);
    assert(result.imported === 0, 'imported = 0', `实际: ${result.imported}`);
    assert(result.skipped === 0, 'skipped = 0', `实际: ${result.skipped}`);
    assert(result.conflicts.length === 0, 'conflicts 为空', `实际长度: ${result.conflicts.length}`);
    assert(result.message === 'CSV 中没有有效的预约', 'message 正确', `实际: ${result.message}`);

    const recordsAfter = db.prepare('SELECT COUNT(*) as cnt FROM precheck_records').get().cnt;
    assert(recordsAfter === recordCountBefore, '查不到时不会按空预约数组导入，precheck_records 数量不变', `实际: ${recordsAfter}, 期望: ${recordCountBefore}`);
  }

  log('--- Test 5: 已取消的预约 ---', 'step');
  {
    const csv = buildCsv([apptCancelled]);
    const result = precheckCsv.importFromCsv(mockReq, csv);

    assert(result.parsed === 1, 'parsed = 1', `实际: ${result.parsed}`);
    assert(result.validCount === 1, 'validCount = 1 (ID有效且存在)', `实际: ${result.validCount}`);
    assert(result.invalid.length === 0, 'invalid 为空', `实际长度: ${result.invalid.length}`);
    assert(result.imported === 0, 'imported = 0 (已取消跳过)', `实际: ${result.imported}`);
    assert(result.skipped === 1, 'skipped = 1', `实际: ${result.skipped}`);
    assert(result.conflicts.length === 0, 'conflicts 为空', `实际长度: ${result.conflicts.length}`);
  }

  log('--- Test 6: 成功导入单个有效预约 ---', 'step');
  {
    const csv = buildCsv([apptMorning1]);
    const result = precheckCsv.importFromCsv(mockReq, csv);

    assert(result.parsed === 1, 'parsed = 1', `实际: ${result.parsed}`);
    assert(result.validCount === 1, 'validCount = 1', `实际: ${result.validCount}`);
    assert(result.invalid.length === 0, 'invalid 为空', `实际长度: ${result.invalid.length}`);
    assert(result.imported === 1, 'imported = 1', `实际: ${result.imported}`);
    assert(result.skipped === 0, 'skipped = 0', `实际: ${result.skipped}`);
    assert(result.conflicts.length === 0, 'conflicts 为空', `实际长度: ${result.conflicts.length}`);
    assert(!!result.batchNo, '返回批次号 batchNo', `实际: ${result.batchNo}`);

    const record = db.prepare('SELECT * FROM precheck_records WHERE appointment_id = ?').get(apptMorning1);
    assert(!!record, 'precheck_records 中已写入记录');
    assert(record && record.status === 'pending', '状态为 pending', `实际: ${record?.status}`);
  }

  log('--- Test 7: 已导入的预约（重复导入应跳过）---', 'step');
  {
    const csv = buildCsv([apptMorning1]);
    const result = precheckCsv.importFromCsv(mockReq, csv);

    assert(result.parsed === 1, 'parsed = 1', `实际: ${result.parsed}`);
    assert(result.validCount === 1, 'validCount = 1', `实际: ${result.validCount}`);
    assert(result.invalid.length === 0, 'invalid 为空', `实际长度: ${result.invalid.length}`);
    assert(result.imported === 0, 'imported = 0 (已导入跳过)', `实际: ${result.imported}`);
    assert(result.skipped === 1, 'skipped = 1', `实际: ${result.skipped}`);
    assert(result.conflicts.length === 0, 'conflicts 为空', `实际长度: ${result.conflicts.length}`);
  }

  log('--- Test 8: 同患者同日期同 period 不同号源 - 冲突 ---', 'step');
  {
    const csv = buildCsv([apptMorning2]);
    const result = precheckCsv.importFromCsv(mockReq, csv);

    assert(result.parsed === 1, 'parsed = 1', `实际: ${result.parsed}`);
    assert(result.validCount === 1, 'validCount = 1', `实际: ${result.validCount}`);
    assert(result.invalid.length === 0, 'invalid 为空', `实际长度: ${result.invalid.length}`);
    assert(result.imported === 0, 'imported = 0 (冲突跳过)', `实际: ${result.imported}`);
    assert(result.skipped === 1, 'skipped = 1 (冲突算跳过)', `实际: ${result.skipped}`);
    assert(result.conflicts.length === 1, 'conflicts 有 1 条', `实际长度: ${result.conflicts.length}`);

    const conflict = result.conflicts[0];
    assert(conflict.appointmentId === apptMorning2, '冲突记录 appointmentId 正确', `实际: ${conflict.appointmentId}`);
    assert(!!conflict.existingDoctor, '冲突原因包含已有医生', `实际: ${conflict.existingDoctor}`);
    assert(!!conflict.existingTime, '冲突原因包含已有时间', `实际: ${conflict.existingTime}`);
    assert(
      conflict.reason.includes('已存在待处理核验记录'),
      '冲突原因包含"已存在待处理核验记录"',
      `实际: ${conflict.reason}`
    );
  }

  log('--- Test 9: 跨 period 不能误拦（患者A 下午号源应可正常导入）---', 'step');
  {
    const csv = buildCsv([apptAfternoon1]);
    const result = precheckCsv.importFromCsv(mockReq, csv);

    assert(result.parsed === 1, 'parsed = 1', `实际: ${result.parsed}`);
    assert(result.validCount === 1, 'validCount = 1', `实际: ${result.validCount}`);
    assert(result.invalid.length === 0, 'invalid 为空', `实际长度: ${result.invalid.length}`);
    assert(result.imported === 1, 'imported = 1 (跨 period 不冲突)', `实际: ${result.imported}`);
    assert(result.skipped === 0, 'skipped = 0', `实际: ${result.skipped}`);
    assert(result.conflicts.length === 0, 'conflicts 为空 (跨 period 不冲突)', `实际长度: ${result.conflicts.length}`);

    const record = db.prepare('SELECT * FROM precheck_records WHERE appointment_id = ?').get(apptAfternoon1);
    assert(!!record, '下午号源记录已成功写入 precheck_records');
  }

  log('--- Test 10: 混合场景（有效+无效+查不到+已取消+已导入+冲突）---', 'step');
  {
    const csv = buildCsv([
      'invalid-id',
      99999,
      apptCancelled,
      apptMorning1,
      apptMorning2,
      apptAfternoon2
    ]);
    const result = precheckCsv.importFromCsv(mockReq, csv);

    assert(result.parsed === 6, 'parsed = 6 (总行数)', `实际: ${result.parsed}`);
    assert(result.validCount === 4, 'validCount = 4 (排除无效ID和查不到的，能查到4个)', `实际: ${result.validCount}`);
    assert(result.invalid.length === 2, 'invalid 有 2 条 (1个无效ID + 1个查不到)', `实际: ${result.invalid.length}`);
    assert(result.imported === 1, 'imported = 1 (只有患者B下午号源能导入)', `实际: ${result.imported}`);
    assert(result.skipped === 3, 'skipped = 3 (已取消+已导入+冲突)', `实际: ${result.skipped}`);
    assert(result.conflicts.length === 1, 'conflicts 有 1 条', `实际长度: ${result.conflicts.length}`);
  }

  log('服务层测试完成', 'pass');
}

async function setupApiTestEnv() {
  log('========================================', 'step');
  log('第二部分：接口层测试准备');
  log('========================================', 'step');

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    log('已清理旧数据库文件');
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  log('执行 seed 初始化...');
  const seedProc = spawn(process.execPath, ['src/seed.js'], {
    env: { ...process.env, DATA_DIR, DB_PATH },
    cwd: __dirname,
    stdio: 'pipe'
  });

  await new Promise((resolve) => {
    seedProc.on('exit', resolve);
  });

  const dbExists = fs.existsSync(DB_PATH);
  assert(dbExists, 'seed 后数据库文件存在');
  log(`seed 完成，数据库大小: ${(fs.statSync(DB_PATH).size / 1024).toFixed(1)} KB`);
}

async function startTestServer() {
  log('启动测试服务...', 'step');

  serverProcess = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, PORT: String(TEST_PORT), DATA_DIR, DB_PATH },
    cwd: __dirname,
    stdio: 'pipe'
  });
  serverPid = serverProcess.pid;

  let serverReady = false;
  serverProcess.stdout.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('已启动') && !serverReady) {
      serverReady = true;
      log('服务启动完成');
    }
  });

  for (let i = 0; i < 30; i++) {
    try {
      const r = await httpRequest('GET', '/api/health');
      if (r.status === 200 && r.body && r.body.status === 'ok') {
        log(`健康检查通过 (尝试 ${i + 1} 次)`);
        return;
      }
    } catch (_) {}
    await sleep(500);
  }

  throw new Error('服务启动超时');
}

async function stopTestServer() {
  if (serverProcess && serverPid) {
    log(`停止测试服务 (PID=${serverPid})...`);
    try {
      serverProcess.kill();
    } catch (_) {}

    await sleep(1000);

    try {
      const { execSync } = require('child_process');
      execSync(`Stop-Process -Id ${serverPid} -Force -ErrorAction SilentlyContinue`, { shell: 'powershell.exe' });
    } catch (_) {}

    serverPid = null;
    serverProcess = null;
    log('测试服务已停止', 'pass');
  }
}

async function runApiLayerTests() {
  log('========================================', 'step');
  log('接口层测试');
  log('========================================', 'step');

  log('登录获取 token...');
  const adminLogin = await httpRequest('POST', '/api/auth/login', {
    username: 'admin',
    password: 'admin123'
  });
  assert(adminLogin.status === 200, 'admin 登录成功', `实际: ${adminLogin.status}`);
  adminToken = adminLogin.body && adminLogin.body.token;
  assert(!!adminToken, '获取 admin token');

  log('--- Test API 1: 空 CSV 导入 ---', 'step');
  {
    const r = await httpRequest('POST', '/api/precheck/csv/import', { content: '' }, adminToken);
    assert(r.status === 200, '接口返回 200', `实际: ${r.status}`);
    assert(r.body.parsed === 0, 'parsed = 0', `实际: ${r.body.parsed}`);
    assert(r.body.validCount === 0, 'validCount = 0', `实际: ${r.body.validCount}`);
    assert(r.body.imported === 0, 'imported = 0', `实际: ${r.body.imported}`);
    assert(r.body.message === 'CSV 为空', 'message = "CSV 为空"', `实际: ${r.body.message}`);
  }

  log('--- Test API 2: 无效预约 ID ---', 'step');
  {
    const csv = buildCsv(['not-a-number', 'abc123']);
    const r = await httpRequest('POST', '/api/precheck/csv/import', { content: csv }, adminToken);
    assert(r.status === 200, '接口返回 200', `实际: ${r.status}`);
    assert(r.body.parsed === 2, 'parsed = 2', `实际: ${r.body.parsed}`);
    assert(r.body.validCount === 0, 'validCount = 0', `实际: ${r.body.validCount}`);
    assert(r.body.invalid.length === 2, 'invalid 有 2 条', `实际: ${r.body.invalid.length}`);
    assert(r.body.message === 'CSV 中没有有效的预约ID', 'message 正确', `实际: ${r.body.message}`);
  }

  log('--- Test API 3: 查不到的预约 ID ---', 'step');
  {
    const csv = buildCsv([99999, 88888]);
    const r = await httpRequest('POST', '/api/precheck/csv/import', { content: csv }, adminToken);
    assert(r.status === 200, '接口返回 200', `实际: ${r.status}`);
    assert(r.body.parsed === 2, 'parsed = 2', `实际: ${r.body.parsed}`);
    assert(r.body.validCount === 0, 'validCount = 0', `实际: ${r.body.validCount}`);
    assert(r.body.invalid.length === 2, 'invalid 有 2 条', `实际: ${r.body.invalid.length}`);
    assert(r.body.invalid[0].error.includes('不存在'), '错误信息包含"不存在"', `实际: ${r.body.invalid[0]?.error}`);
    assert(r.body.imported === 0, 'imported = 0', `实际: ${r.body.imported}`);
    assert(r.body.conflicts.length === 0, 'conflicts 为空', `实际长度: ${r.body.conflicts.length}`);
  }

  log('--- Test API 4: CSV 解析接口 (parse) ---', 'step');
  {
    const csv = buildCsv(['1', '2', 'invalid']);
    const r = await httpRequest('POST', '/api/precheck/csv/parse', { content: csv }, adminToken);
    assert(r.status === 200, '接口返回 200', `实际: ${r.status}`);
    assert(r.body.parsed === 3, 'parsed = 3', `实际: ${r.body.parsed}`);
    assert(r.body.valid.length === 2, 'valid 有 2 条', `实际: ${r.body.valid.length}`);
    assert(r.body.invalid.length === 1, 'invalid 有 1 条', `实际: ${r.body.invalid.length}`);
  }

  log('--- Test API 5: 获取 CSV 模板 ---', 'step');
  {
    const r = await httpRequest('GET', '/api/precheck/csv/template', null, adminToken);
    assert(r.status === 200, '接口返回 200', `实际: ${r.status}`);
    assert(
      typeof r.raw === 'string' && r.raw.includes('预约ID'),
      '返回 CSV 模板且包含"预约ID"列'
    );
  }

  log('接口层测试完成', 'pass');
}

async function main() {
  log('');
  log('╔══════════════════════════════════════════════════════════╗', 'step');
  log('║     术前核验 CSV 导入回归测试                           ║', 'step');
  log('╚══════════════════════════════════════════════════════════╝', 'step');
  log(`测试端口: ${TEST_PORT}`);
  log(`数据目录: ${DATA_DIR}`);
  log(`数据库: ${DB_PATH}`);
  log('');

  try {
    await runServiceLayerTests();

    log('');
    await setupApiTestEnv();
    await startTestServer();
    await runApiLayerTests();

  } catch (e) {
    log(`测试执行异常: ${e.message}`, 'fail');
    if (e.stack) console.error(e.stack);
    testFailed++;
    testErrors.push(`测试异常: ${e.message}`);
  } finally {
    await stopTestServer();
  }

  log('');
  log('╔══════════════════════════════════════════════════════════╗', 'step');
  log('║     测试结果汇总                                         ║', 'step');
  log('╚══════════════════════════════════════════════════════════╝', 'step');
  log(`通过: ${testPassed}`);
  log(`失败: ${testFailed}`);

  if (testErrors.length > 0) {
    log('失败详情:', 'fail');
    testErrors.forEach((e, i) => log(`  ${i + 1}. ${e}`, 'fail'));
  }

  if (testFailed === 0) {
    log('🎉 所有测试通过！', 'pass');
  }

  process.exit(testFailed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('致命错误:', e);
  process.exit(99);
});
