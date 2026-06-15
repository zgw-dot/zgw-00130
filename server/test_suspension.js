const axios = require('axios');
const path = require('path');
const fs = require('fs');

const PORT = process.env.TEST_PORT || 3099;
const BASE_URL = `http://localhost:${PORT}`;

let adminToken = null;
let clerkToken = null;
let batchId1 = null;
let batchId2 = null;
let batchNo1 = null;
let serverProcess = null;

const log = (msg, type = 'info') => {
  const prefix = type === 'pass' ? '✅' : type === 'fail' ? '❌' : type === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} ${msg}`);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let serverPid = null;

const DATA_DIR = path.join(__dirname, 'data_test_suspension');

async function startServer(resetDb = false) {
  log('启动测试服务...');
  const { spawn } = require('child_process');
  
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  
  const dbFile = path.join(DATA_DIR, 'app.db');
  if (resetDb && fs.existsSync(dbFile)) {
    log('重置数据库...');
    fs.unlinkSync(dbFile);
  }
  
  const env = { ...process.env, PORT, DATA_DIR };
  
  if (resetDb || !fs.existsSync(dbFile)) {
    log('初始化种子数据...');
    const seedProc = spawn('node', ['src/seed.js'], { env, cwd: __dirname, stdio: 'pipe' });
    await new Promise((resolve) => {
      seedProc.on('exit', resolve);
    });
  }
  
  serverProcess = spawn('node', ['src/index.js'], { env, cwd: __dirname, stdio: 'pipe' });
  serverPid = serverProcess.pid;
  
  log(`测试服务已启动，PID=${serverPid}，端口=${PORT}`);
  log(`数据目录: ${DATA_DIR}`);
  log(`数据库文件: ${dbFile} (${fs.existsSync(dbFile) ? (fs.statSync(dbFile).size / 1024).toFixed(1) + ' KB' : '不存在'})`);
  
  let started = false;
  serverProcess.stdout.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('已启动') && !started) {
      started = true;
      log('服务初始化完成');
    }
  });
  serverProcess.stderr.on('data', (data) => {
    // 忽略正常日志
  });
  
  await sleep(3000);
  return serverProcess;
}

async function stopServer() {
  if (serverProcess && serverPid) {
    log(`停止测试服务 (PID=${serverPid})...`);
    try {
      const { execSync } = require('child_process');
      try {
        const result = execSync(`Stop-Process -Id ${serverPid} -Force -ErrorAction Stop`, { shell: 'powershell.exe' });
        log(`已通过 PowerShell Stop-Process 终止 PID=${serverPid}`, 'pass');
      } catch (e) {
        log(`PowerShell 停止失败，尝试直接 kill: ${e.message}`, 'warn');
        try { serverProcess.kill(); } catch (_) {}
      }
    } catch (e) {
      log(`停止服务异常: ${e.message}`, 'warn');
    }
    
    await sleep(1500);
    
    try {
      const { execSync } = require('child_process');
      const check = execSync(`netstat -ano | findstr ":${PORT}" | findstr LISTENING`, { shell: 'cmd.exe' }).toString().trim();
      if (check) {
        log(`⚠️ 端口 ${PORT} 仍有监听，可能存在残留进程`, 'warn');
        log(check);
      } else {
        log(`✅ 端口 ${PORT} 已释放`, 'pass');
      }
    } catch (_) {}
    
    serverPid = null;
  }
}

async function login(username, password) {
  const res = await axios.post(`${BASE_URL}/api/auth/login`, { username, password });
  return res.data.token;
}

const api = (token) => axios.create({
  baseURL: `${BASE_URL}/api`,
  headers: { Authorization: `Bearer ${token}` },
  validateStatus: () => true
});

async function runTests() {
  const results = [];
  const test = (name, fn) => results.push({ name, fn });

  test('管理员登录', async () => {
    adminToken = await login('admin', 'admin123');
    if (!adminToken) throw new Error('管理员登录失败');
    log('管理员登录成功', 'pass');
  });

  test('办事员登录', async () => {
    clerkToken = await login('clerk1', 'clerk123');
    if (!clerkToken) throw new Error('办事员登录失败');
    log('办事员登录成功', 'pass');
  });

  test('创建批次草稿', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.post('/suspension/batches', {
      title: '测试批次1 - 张医生停诊',
      reason: '医生外出开会',
      remarks: '测试备注'
    });
    if (res.status !== 200 || !res.data.batch) throw new Error('创建批次失败');
    batchId1 = res.data.batch.id;
    batchNo1 = res.data.batch.batch_no;
    if (res.data.batch.status !== 'draft') throw new Error('批次状态应为 draft');
    log(`批次草稿创建成功: ${batchNo1}`, 'pass');
  });

  test('添加停诊条目', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.post(`/suspension/batches/${batchId1}/items`, {
      items: [
        { type: 'doctor', value: '1', description: '张医生停诊' },
        { type: 'date', value: new Date().toISOString().split('T')[0], description: '今日全天' }
      ]
    });
    if (res.status !== 200) throw new Error('添加条目失败');
    if (res.data.items.length !== 2) throw new Error('条目数量不对');
    log('停诊条目添加成功', 'pass');
  });

  test('预览受影响数据', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.get(`/suspension/batches/${batchId1}/preview`);
    if (res.status !== 200) throw new Error('预览失败');
    const { totals } = res.data;
    log(`预览成功: ${totals.slotCount}个号源, ${totals.appointmentCount}个预约, ${totals.waitlistCount}个候补, ${totals.conflictCount}个冲突`, 'pass');
    if (totals.slotCount === 0) throw new Error('应该有受影响的号源');
  });

  test('保存草稿并锁定号源', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.post(`/suspension/batches/${batchId1}/save-draft`);
    if (res.status !== 200) throw new Error(`保存草稿失败: ${res.data.error}`);
    if (res.data.batch.status !== 'pending') throw new Error('状态应变为 pending');
    log(`草稿保存成功: ${res.data.slotCount}个号源已锁定`, 'pass');
  });

  test('号源冲突拦截 - 创建第二个批次', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.post('/suspension/batches', {
      title: '测试批次2 - 冲突测试',
      reason: '测试冲突'
    });
    if (res.status !== 200 || !res.data.batch) {
      throw new Error(`创建批次失败: ${res.status} ${res.data.error || ''}`);
    }
    batchId2 = res.data.batch.id;
    log(`第二个批次创建成功: ${res.data.batch.batch_no}`, 'pass');

    await adminApi.post(`/suspension/batches/${batchId2}/items`, {
      items: [{ type: 'doctor', value: '1', description: '同一位医生' }]
    });

    const previewRes = await adminApi.get(`/suspension/batches/${batchId2}/preview`);
    if (previewRes.data.totals.conflictCount === 0) {
      throw new Error('应该检测到号源冲突');
    }
    log(`冲突拦截成功: 检测到 ${previewRes.data.totals.conflictCount} 个冲突号源`, 'pass');

    const saveRes = await adminApi.post(`/suspension/batches/${batchId2}/save-draft`);
    if (saveRes.status !== 400 || !saveRes.data.error?.includes('冲突')) {
      throw new Error('保存冲突号源应该被拒绝');
    }
    log('冲突号源保存被正确拒绝', 'pass');
  });

  test('办事员尝试执行批次 - 权限拦截', async () => {
    const clerkApi1 = api(clerkToken);
    const res = await clerkApi1.post(`/suspension/batches/${batchId1}/execute`);
    if (res.status !== 403) throw new Error('办事员执行批次应该被拒绝');
    log('办事员执行批次权限拦截成功', 'pass');
  });

  test('管理员执行批次', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.post(`/suspension/batches/${batchId1}/execute`);
    if (res.status !== 200) throw new Error(`执行失败: ${res.data.error}`);
    if (res.data.batch.status !== 'completed') throw new Error('状态应变为 completed');
    
    const r = res.data.results;
    log(`执行成功: 预约${r.appointments.success}成功/${r.appointments.failed}失败, 候补${r.waitlist.success}成功/${r.waitlist.failed}失败`, 'pass');
    
    if (r.appointments.success === 0 && r.waitlist.success === 0) {
      throw new Error('应该有处理成功的记录');
    }
  });

  test('查看批次详情', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.get(`/suspension/batches/${batchId1}`);
    if (res.status !== 200) throw new Error('获取详情失败');
    const d = res.data;
    log(`详情查询成功: ${d.affectedAppointments.length}个预约, ${d.affectedWaitlist.length}个候补, ${d.notifications.length}个通知`, 'pass');
    if (d.notifications.length === 0) throw new Error('应该生成患者通知');
  });

  test('导出受影响患者 CSV', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.get(`/suspension/csv/export/${batchId1}/affected`, { responseType: 'arraybuffer' });
    if (res.status !== 200) throw new Error('导出失败');
    
    let buffer;
    if (Buffer.isBuffer(res.data)) {
      buffer = res.data;
    } else if (typeof res.data === 'string') {
      buffer = Buffer.from(res.data, 'binary');
    } else if (res.data instanceof ArrayBuffer) {
      buffer = Buffer.from(res.data);
    } else {
      buffer = Buffer.from(String(res.data));
    }
    
    const hasBom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
    if (!hasBom) {
      console.log('First 10 bytes:', buffer.slice(0, 10).toString('hex'));
      throw new Error('CSV 应该有 BOM 头 (0xEF 0xBB 0xBF)');
    }
    
    const csv = buffer.toString('utf8');
    const lines = csv.split('\n').filter(l => l.trim());
    log(`导出成功: ${lines.length - 1} 条记录`, 'pass');
    if (lines.length < 2) throw new Error('CSV 应该有数据行');
  });

  test('导出处理结果 CSV', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.get(`/suspension/csv/export/${batchId1}/results`);
    if (res.status !== 200) throw new Error('导出失败');
    const csv = typeof res.data === 'string' ? res.data : Buffer.from(res.data).toString('utf8');
    const lines = csv.split('\n').filter(l => l.trim());
    log(`处理结果导出: ${lines.length - 1} 条记录`, 'pass');
  });

  test('导出未处理记录 CSV', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.get(`/suspension/csv/export/${batchId1}/unprocessed`);
    if (res.status !== 200) throw new Error('导出失败');
    const csv = typeof res.data === 'string' ? res.data : Buffer.from(res.data).toString('utf8');
    const lines = csv.split('\n').filter(l => l.trim());
    log(`未处理记录导出: ${lines.length - 1} 条记录`, 'pass');
  });

  test('CSV 导入停诊名单', async () => {
    const adminApi = api(adminToken);
    const csvContent = '类型,值,描述\n日期,2025-01-01,元旦停诊\n医生,2,李医生停诊\n';
    const res = await adminApi.post('/suspension/csv/import', { content: csvContent });
    if (res.status !== 200) throw new Error('导入失败');
    if (res.data.validCount !== 2) throw new Error('应该导入2条有效数据');
    log(`CSV 导入成功: ${res.data.validCount}条有效, ${res.data.errorCount}条错误`, 'pass');
  });

  test('查询停诊配置', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.get('/suspension/config');
    if (res.status !== 200) throw new Error('获取配置失败');
    log(`配置查询成功: 策略=${res.data.config.waitlistStrategy}, 自动通知=${res.data.config.autoNotify}`, 'pass');
  });

  test('修改停诊配置 - 切换为人工确认', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.put('/suspension/config', {
      key: 'suspension_waitlist_strategy',
      value: 'manual_review'
    });
    if (res.status !== 200) throw new Error('修改配置失败');
    if (res.data.oldValue !== 'auto_postpone') throw new Error('旧值不对');
    if (res.data.newValue !== 'manual_review') throw new Error('新值不对');
    log('配置切换成功: auto_postpone → manual_review', 'pass');
  });

  test('办事员修改配置 - 权限拦截', async () => {
    const clerkApi1 = api(clerkToken);
    const res = await clerkApi1.put('/suspension/config', {
      key: 'suspension_waitlist_strategy',
      value: 'auto_postpone'
    });
    if (res.status !== 403) throw new Error('办事员修改配置应该被拒绝');
    log('办事员修改配置权限拦截成功', 'pass');
  });

  test('撤销草稿批次', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.post(`/suspension/batches/${batchId2}/revoke`, {
      reason: '测试撤销'
    });
    if (res.status !== 200) throw new Error(`撤销失败: ${res.data.error}`);
    if (res.data.batch.status !== 'revoked') throw new Error('状态应变为 revoked');
    
    const s = res.data.restoreStats;
    log(`撤销成功: 恢复${s.restoredAppointments}个预约, ${s.restoredWaitlist}个候补, ${s.restoredSlots}个号源`, 'pass');
    
    if (!res.data.revocationRecord) throw new Error('应该有撤销记录');
  });

  test('查询所有批次', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.get('/suspension/batches');
    if (res.status !== 200) throw new Error('查询失败');
    log(`批次列表: ${res.data.batches.length} 个批次`, 'pass');
    if (res.data.batches.length < 2) throw new Error('应该至少有2个批次');
  });

  test('查询导出记录', async () => {
    const adminApi = api(adminToken);
    const res = await adminApi.get('/suspension/exports', { params: { batchId: batchId1 } });
    if (res.status !== 200) throw new Error('查询失败');
    log(`导出记录: ${res.data.exports.length} 条`, 'pass');
    if (res.data.exports.length < 3) throw new Error('应该至少有3条导出记录');
  });

  test('重启服务后复查 - 数据持久化', async () => {
    log('重启服务测试持久化（不重置数据库）...');
    await stopServer();
    await sleep(2000);
    await startServer(false);
    await sleep(2000);

    adminToken = await login('admin', 'admin123');
    const adminApi = api(adminToken);

    const res = await adminApi.get(`/suspension/batches/${batchId1}`);
    if (res.status !== 200) throw new Error('重启后查询失败');
    if (res.data.batch.batch_no !== batchNo1) throw new Error('批次号不匹配');
    if (res.data.batch.status !== 'completed') throw new Error('状态不匹配');
    
    const d = res.data;
    log(`重启复查成功: ${d.batch.batch_no} 状态=${d.batch.status}, ${d.affectedAppointments.length}个预约, ${d.affectedWaitlist.length}个候补`, 'pass');

    const configRes = await adminApi.get('/suspension/config');
    if (configRes.data.config.waitlistStrategy !== 'manual_review') {
      throw new Error('配置修改没有持久化');
    }
    log('配置持久化验证通过', 'pass');

    const revokeRes = await adminApi.get(`/suspension/batches/${batchId2}`);
    if (revokeRes.data.batch.status !== 'revoked') {
      throw new Error('撤销状态没有持久化');
    }
    if (!revokeRes.data.revocation) {
      throw new Error('撤销记录没有持久化');
    }
    log('撤销记录持久化验证通过', 'pass');
  });

  test('恢复配置为自动顺延', async () => {
    const adminApi = api(adminToken);
    await adminApi.put('/suspension/config', {
      key: 'suspension_waitlist_strategy',
      value: 'auto_postpone'
    });
    log('配置已恢复为 auto_postpone', 'pass');
  });

  console.log('\n' + '='.repeat(60));
  console.log('开始执行测试套件');
  console.log('='.repeat(60) + '\n');

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const t of results) {
    try {
      log(`[测试] ${t.name}`);
      await t.fn();
      passed++;
    } catch (e) {
      failed++;
      failures.push({ name: t.name, error: e.message });
      log(`测试失败: ${e.message}`, 'fail');
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(60));

  if (failures.length > 0) {
    console.log('\n失败详情:');
    failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
    process.exit(1);
  } else {
    console.log('\n✅ 所有测试通过!');
    process.exit(0);
  }
}

async function main() {
  try {
    await startServer(true);
    await runTests();
  } catch (e) {
    console.error('测试执行异常:', e);
    process.exit(1);
  } finally {
    await stopServer();
  }
}

main();
