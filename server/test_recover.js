const http = require('http');

const BASE = 'http://localhost:3001/api';
let passed = 0, failed = 0;

function request(method, path, data, token) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const u = new URL(BASE + path);
    const opts = {
      hostname: u.hostname, port: u.port,
      path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body || '')
      }
    };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode, body: parsed, raw: text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const assert = (cond, msg) => {
  if (cond) { passed++; console.log(`✅ ${msg}`); }
  else { failed++; console.log(`❌ ${msg}`); }
};

const title = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  try {
    // 1. 登录 admin + 记录审计 baseline
    const a = await request('POST', '/auth/login', { username: 'admin', password: 'admin123' });
    const adminToken = a.body.token;
    assert(a.status === 200, 'admin 登录成功');

    const baselineRecover = (await request('GET', '/audit-logs?action=recover_noshow&limit=1000', null, adminToken)).body.list.length;
    let expectedRecover = baselineRecover;

    const c = await request('POST', '/auth/login', { username: 'clerk1', password: 'clerk123' });
    const clerkToken = c.body.token;
    assert(c.status === 200, 'clerk1 登录成功');

    // 2. 找到一个 booked 预约，标记爽约，生成爽约记录
    const appts = await request('GET', '/appointments?status=booked', null, adminToken);
    const appt = appts.body.list[0];
    assert(appt, '找到一条已预约记录');
    const slotId = appt.slot_id;
    const apptId = appt.id;

    // 记录初始状态
    const slotDetailBefore = (await request('GET', `/slots/${slotId}`, null, adminToken)).body;
    const availBefore = slotDetailBefore.slot.available_count;

    const rel = await request('POST', `/appointments/${apptId}/release-noshow`, { reason: '测试爽约' }, adminToken);
    assert(rel.status === 200, '标记爽约成功');

    // 3. 找到刚生成的未恢复爽约记录
    const ns = await request('GET', '/no-show-records?recovered=false', null, adminToken);
    const record = ns.body.list.find(r => r.appointment_id === apptId);
    assert(record, '找到未恢复的爽约记录');
    const recordId = record.id;
    assert(record.reason === '测试爽约', '爽约原因正确写入');

    // ============ 异常：空原因（各种形式）都要拦截 ============

    title('异常：admin 各种空原因恢复都被拦截');

    // 3.1 null 原因
    const r1 = await request('POST', `/no-show-records/${recordId}/recover`, { reason: null }, adminToken);
    assert(r1.status === 400 && /必须提供原因/.test(r1.body.error),
      `admin null 原因被拦截 (status=${r1.status}, msg=${r1.body?.error})`);

    // 3.2 空字符串
    const r2 = await request('POST', `/no-show-records/${recordId}/recover`, { reason: '' }, adminToken);
    assert(r2.status === 400 && /必须提供原因/.test(r2.body.error),
      `admin 空字符串被拦截 (status=${r2.status})`);

    // 3.3 纯空格
    const r3 = await request('POST', `/no-show-records/${recordId}/recover`, { reason: '   ' }, adminToken);
    assert(r3.status === 400 && /必须提供原因/.test(r3.body.error),
      `admin 纯空格被拦截 (status=${r3.status})`);

    // 3.4 不传 reason 字段
    const r4 = await request('POST', `/no-show-records/${recordId}/recover`, {}, adminToken);
    assert(r4.status === 400 && /必须提供原因/.test(r4.body.error),
      `admin 不传 reason 字段被拦截 (status=${r4.status})`);

    // 3.5 clerk 也同样被拦截（确认一致性）
    const r5 = await request('POST', `/no-show-records/${recordId}/recover`, { reason: '' }, clerkToken);
    assert(r5.status === 400 && /必须提供原因/.test(r5.body.error),
      `clerk 空原因同样被拦截 (status=${r5.status})`);

    // 3.6 记录状态仍然是未恢复
    const nsAfter = await request('GET', `/no-show-records/${recordId}`, null, adminToken).catch(() => null);
    // 可能没有单条GET接口，直接用列表查
    const listAfter = (await request('GET', '/no-show-records?recovered=false', null, adminToken)).body.list;
    const stillThere = listAfter.find(r => r.id === recordId);
    assert(!!stillThere, '拦截后爽约记录仍保持未恢复状态');

    // ============ 正常：有真实原因恢复成功，副作用正确 ============

    title('正常：admin 填真实原因恢复，副作用全部正确');

    // 初始通知数
    const notifBefore = (await request('GET', `/notifications?slotId=${slotId}`, null, adminToken)).body.list.length;

    const recoverResult = await request('POST', `/no-show-records/${recordId}/recover`,
      { reason: '  患者已到现场，手动恢复  ' }, adminToken);

    assert(recoverResult.status === 200, `恢复成功 (status=${recoverResult.status})`);
    assert(recoverResult.body.recoveryReason === '患者已到现场，手动恢复',
      `恢复原因被 trim 后正确存储: "${recoverResult.body.recoveryReason}"`);
    assert(recoverResult.body.recoveredAt, '有恢复时间');

    // 4. 验证爽约记录
    const recRecord = (await request('GET', '/no-show-records?recovered=true', null, adminToken))
      .body.list.find(r => r.id === recordId);
    assert(recRecord, '爽约记录出现在已恢复列表');
    assert(recRecord.recovery_reason === '患者已到现场，手动恢复',
      `数据库中 recovery_reason 正确: "${recRecord.recovery_reason}"`);
    assert(recRecord.recovered_by_name === 'admin', '恢复操作人正确');

    // 5. 验证预约状态变回 confirmed
    const apptAfter = (await request('GET', '/appointments', null, adminToken))
      .body.list.find(a => a.id === apptId);
    assert(apptAfter.status === 'confirmed', `预约状态变回 confirmed (实际: ${apptAfter.status})`);

    // 6. 验证号源名额：恢复后应回到爽约前的数量（爽约+恢复抵消）
    const slotDetailAfter = (await request('GET', `/slots/${slotId}`, null, adminToken)).body;
    const availAfter = slotDetailAfter.slot.available_count;
    assert(availAfter === availBefore,
      `恢复后号源可用名额回到原值 (爽约前: ${availBefore}, 恢复后: ${availAfter})`);

    // 同时验证：标记爽约时名额确实 +1 了（用间接方式验证逻辑完整性）
    // 再制造一次爽约，观察名额变化
    const apptsB = await request('GET', '/appointments?status=booked', null, adminToken);
    const apptB = apptsB.body.list[0];
    if (apptB) {
      const availB = (await request('GET', `/slots/${apptB.slot_id}`, null, adminToken)).body.slot.available_count;
      await request('POST', `/appointments/${apptB.id}/release-noshow`, { reason: '测试校验名额' }, adminToken);
      const availC = (await request('GET', `/slots/${apptB.slot_id}`, null, adminToken)).body.slot.available_count;
      assert(availC === availB + 1,
        `标记爽约后号源名额 +1 (前: ${availB}, 后: ${availC})`);
    }

    // 7. 验证通知新增一条 recovered
    const notifAfter = (await request('GET', `/notifications?slotId=${slotId}`, null, adminToken)).body.list;
    const recoveredNotif = notifAfter.find(n => n.type === 'recovered');
    assert(notifAfter.length === notifBefore + 1,
      `通知日志新增 1 条 (前: ${notifBefore}, 后: ${notifAfter.length})`);
    assert(recoveredNotif, '新增了 recovered 类型通知');
    assert(/已恢复|继续有效/.test(recoveredNotif.message), '通知内容包含恢复关键字');

    // 8. 验证审计日志新增 recover_noshow（用 baseline + 成功次数方式，避免历史数据干扰）
    expectedRecover++; // admin 本次成功恢复 1 次
    const allRecoverLogs = (await request('GET', '/audit-logs?action=recover_noshow&limit=1000', null, adminToken)).body.list;
    assert(allRecoverLogs.length === expectedRecover,
      `recover_noshow 审计日志总数正确 (预期: ${expectedRecover}, 实际: ${allRecoverLogs.length})`);

    const lastRecover = allRecoverLogs[0]; // ORDER BY DESC，最新在最前
    assert(lastRecover && lastRecover.action === 'recover_noshow', `最新恢复审计记录存在`);
    assert(lastRecover.reason === '患者已到现场，手动恢复',
      `审计原因字段正确: "${lastRecover.reason}"`);
    assert(lastRecover.entity_type === 'no_show_record', '审计实体类型正确');
    assert(lastRecover.entity_id == recordId, '审计实体 ID 正确');
    assert(lastRecover.user_name === 'admin', '审计操作人正确');

    // ============ 再测一条：clerk 带原因也能成功 ============

    title('验证：clerk 提供真实原因也能正常恢复');

    // 再找一个预约，制造第二条爽约
    const appts2 = await request('GET', '/appointments?status=booked', null, adminToken);
    const appt2 = appts2.body.list[0];
    if (appt2) {
      const rel2 = await request('POST', `/appointments/${appt2.id}/release-noshow`, { reason: '测试爽约2' }, adminToken);
      const ns2 = await request('GET', '/no-show-records?recovered=false', null, adminToken);
      const rec2 = ns2.body.list.find(r => r.appointment_id === appt2.id);

      if (rec2) {
        const clerkRecover = await request('POST', `/no-show-records/${rec2.id}/recover`,
          { reason: '患者申诉成功，予以恢复' }, clerkToken);
        assert(clerkRecover.status === 200,
          `clerk 带原因恢复成功 (status=${clerkRecover.status})`);
        assert(clerkRecover.body.recoveryReason === '患者申诉成功，予以恢复',
          'clerk 恢复原因正确存储');
        expectedRecover++;

        const finalRecoverLogs = (await request('GET', '/audit-logs?action=recover_noshow&limit=1000', null, adminToken)).body.list;
        assert(finalRecoverLogs.length === expectedRecover,
          `clerk 恢复后审计总数正确 (预期: ${expectedRecover}, 实际: ${finalRecoverLogs.length})`);
        const lastClerkLog = finalRecoverLogs[0];
        assert(lastClerkLog.user_name === 'clerk1', 'clerk 恢复审计操作人正确');
        assert(lastClerkLog.reason === '患者申诉成功，予以恢复', 'clerk 恢复原因审计正确');
      }
    } else {
      console.log('⚠️  跳过 clerk 测试：没有更多 booked 预约可用来制造爽约');
    }

    // ============ 总结 ============
    console.log(`\n======================`);
    console.log(`通过: ${passed}, 失败: ${failed}`);
    console.log(`======================`);
    process.exitCode = failed > 0 ? 1 : 0;

  } catch (e) {
    console.error('\n❌ 测试异常:', e.message, e.stack);
    process.exitCode = 1;
  }
})();
