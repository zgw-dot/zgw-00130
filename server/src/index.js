const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { JWT_SECRET, authMiddleware, requireAdmin, requireConfigPermission, getClientIp } = require('./middleware');
const { logAudit } = require('./audit');
const timeCtrl = require('./time');
const wl = require('./waitlist');

const PORT = process.env.PORT || 3001;
const app = express();

const envDataDir = process.env.DATA_DIR;
const dataDir = envDataDir
  ? path.isAbsolute(envDataDir) ? envDataDir : path.join(__dirname, '..', envDataDir)
  : path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const tryJson = (s) => {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
};

const errorHandler = (err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || '服务器内部错误' });
};

app.post('/api/auth/login', (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    logAudit({ user: { id: user.id }, headers: req.headers, ip: getClientIp(req) }, {
      action: 'login', entityType: 'auth', entityId: user.id,
      newValue: { username: user.username, role: user.role },
      reason: '用户登录'
    });
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (e) { next(e); }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/time', (req, res) => {
  const override = timeCtrl.getTimeOverride();
  const now = timeCtrl.getCurrentTime();
  res.json({
    mode: override.mode,
    currentTime: timeCtrl.formatDateTime(now),
    currentIso: now.toISOString(),
    override,
    realTime: timeCtrl.formatDateTime(new Date())
  });
});

app.post('/api/time/set', authMiddleware, requireAdmin, (req, res, next) => {
  try {
    const { time, speed } = req.body || {};
    let updated = {};
    if (time) {
      const d = new Date(time);
      if (isNaN(d)) return res.status(400).json({ error: '时间格式错误' });
      timeCtrl.setManualTime(d.toISOString());
      updated.currentTime = d.toISOString();
    }
    if (typeof speed === 'number') {
      timeCtrl.setSpeedMultiplier(speed);
      updated.speed = speed;
    }
    const now = timeCtrl.getCurrentTime();
    logAudit(req, {
      action: 'set_time', entityType: 'system', entityId: 1,
      newValue: { ...updated, mode: 'manual' },
      reason: '设置系统时间覆盖'
    });
    res.json({
      mode: 'manual',
      currentTime: timeCtrl.formatDateTime(now),
      currentIso: now.toISOString(),
      ...updated
    });
  } catch (e) { next(e); }
});

app.post('/api/time/advance', authMiddleware, (req, res, next) => {
  try {
    const { seconds } = req.body || {};
    const s = parseInt(seconds || '0', 10);
    if (s <= 0) return res.status(400).json({ error: '秒数必须为正整数' });
    const newTime = timeCtrl.advanceTime(s);
    wl.checkAndProcessExpired();
    logAudit(req, {
      action: 'advance_time', entityType: 'system', entityId: 1,
      newValue: { advanceSeconds: s, newTime: timeCtrl.formatDateTime(newTime) },
      reason: `手动推进时间 ${s} 秒`
    });
    res.json({
      mode: 'manual',
      currentTime: timeCtrl.formatDateTime(newTime),
      currentIso: newTime.toISOString(),
      advancedSeconds: s
    });
  } catch (e) { next(e); }
});

app.post('/api/time/reset', authMiddleware, requireAdmin, (req, res, next) => {
  try {
    timeCtrl.resetToRealTime();
    const now = timeCtrl.getCurrentTime();
    logAudit(req, {
      action: 'reset_time', entityType: 'system', entityId: 1,
      newValue: { mode: 'real' },
      reason: '重置为真实时间'
    });
    res.json({
      mode: 'real',
      currentTime: timeCtrl.formatDateTime(now),
      currentIso: now.toISOString()
    });
  } catch (e) { next(e); }
});

app.post('/api/time/trigger-expire', authMiddleware, (req, res, next) => {
  try {
    const manualEnabled = wl.getConfig('manual_trigger_enabled') === 'true';
    if (!manualEnabled && req.user.role !== 'admin') {
      return res.status(403).json({ error: '手动触发超时功能已禁用' });
    }
    const processed = wl.checkAndProcessExpired();
    logAudit(req, {
      action: 'trigger_expire', entityType: 'system', entityId: 1,
      newValue: { processedCount: processed.length },
      reason: '手动触发超时处理'
    });
    res.json({ processedCount: processed.length, processed });
  } catch (e) { next(e); }
});

app.get('/api/doctors', authMiddleware, (req, res) => {
  const doctors = db.prepare('SELECT * FROM doctors ORDER BY department, name').all();
  res.json({ list: doctors });
});

app.post('/api/doctors', authMiddleware, requireAdmin, (req, res, next) => {
  try {
    const { name, department, title } = req.body || {};
    if (!name || !department) return res.status(400).json({ error: '姓名和科室必填' });
    const r = db.prepare('INSERT INTO doctors (name, department, title) VALUES (?, ?, ?)').run(name, department, title || null);
    const id = r.lastInsertRowid;
    logAudit(req, { action: 'create_doctor', entityType: 'doctor', entityId: id, newValue: { name, department, title }, reason: '新增医生' });
    res.json({ id, name, department, title });
  } catch (e) { next(e); }
});

app.get('/api/slots', authMiddleware, (req, res) => {
  const { date, doctorId, status } = req.query;
  let sql = `
    SELECT s.*, d.name as doctor_name, d.department, d.title,
      (SELECT COUNT(*) FROM waitlist w WHERE w.slot_id = s.id AND w.status IN ('waiting', 'notifying')) as waitlist_count,
      (SELECT COUNT(*) FROM appointments a WHERE a.slot_id = s.id AND a.status IN ('booked', 'confirmed')) as booked_count
    FROM slots s JOIN doctors d ON s.doctor_id = d.id WHERE 1=1
  `;
  const params = [];
  if (date) { sql += ' AND s.date = ?'; params.push(date); }
  if (doctorId) { sql += ' AND s.doctor_id = ?'; params.push(doctorId); }
  if (status) { sql += ' AND s.status = ?'; params.push(status); }
  sql += ' ORDER BY s.date, s.doctor_id, CASE s.period WHEN "morning" THEN 1 WHEN "afternoon" THEN 2 ELSE 3 END';
  const slots = db.prepare(sql).all(...params);
  res.json({ list: slots });
});

app.get('/api/slots/:id', authMiddleware, (req, res) => {
  const slot = db.prepare(`
    SELECT s.*, d.name as doctor_name, d.department, d.title
    FROM slots s JOIN doctors d ON s.doctor_id = d.id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!slot) return res.status(404).json({ error: '号源不存在' });
  const next = wl.getNextWaiter(slot.id);
  res.json({ slot, nextWaiter: next });
});

app.post('/api/slots', authMiddleware, requireAdmin, (req, res, next) => {
  try {
    const { doctor_id, date, period, time_start, time_end, capacity } = req.body || {};
    if (!doctor_id || !date || !period || !time_start || !time_end) {
      return res.status(400).json({ error: '参数不完整' });
    }
    const cap = parseInt(capacity || '10', 10);
    const r = db.prepare(`
      INSERT INTO slots (doctor_id, date, period, time_start, time_end, capacity, available_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(doctor_id, date, period, time_start, time_end, cap, cap, cap > 0 ? 'active' : 'closed');
    const id = r.lastInsertRowid;
    logAudit(req, {
      action: 'create_slot', entityType: 'slot', entityId: id,
      newValue: { doctor_id, date, period, capacity: cap },
      reason: '新增号源'
    });
    res.json({ id, ...req.body, capacity: cap, available_count: cap });
  } catch (e) { next(e); }
});

app.put('/api/slots/:id/availability', authMiddleware, (req, res, next) => {
  try {
    const { delta } = req.body || {};
    const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(req.params.id);
    if (!slot) return res.status(404).json({ error: '号源不存在' });
    const oldVal = slot.available_count;
    const newVal = Math.max(0, Math.min(slot.capacity, slot.available_count + (parseInt(delta || '0', 10))));
    db.prepare(`
      UPDATE slots SET available_count = ?,
        status = CASE WHEN ? <= 0 THEN 'full' WHEN status = 'closed' THEN 'closed' ELSE 'active' END
      WHERE id = ?
    `).run(newVal, newVal, req.params.id);
    logAudit(req, {
      action: 'update_availability', entityType: 'slot', entityId: slot.id,
      slotId: slot.id, oldValue: { available_count: oldVal }, newValue: { available_count: newVal, delta },
      reason: '调整可用号源数量'
    });
    res.json({ id: slot.id, available_count: newVal });
  } catch (e) { next(e); }
});

app.get('/api/patients', authMiddleware, (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM patients';
  const params = [];
  if (q) { sql += ' WHERE name LIKE ? OR phone LIKE ? OR id_card LIKE ?'; const like = `%${q}%`; params.push(like, like, like); }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const patients = db.prepare(sql).all(...params);
  res.json({ list: patients });
});

app.post('/api/patients', authMiddleware, (req, res, next) => {
  try {
    const { name, phone, id_card } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: '姓名和电话必填' });
    const r = db.prepare('INSERT INTO patients (name, phone, id_card) VALUES (?, ?, ?)').run(name, phone, id_card || null);
    const id = r.lastInsertRowid;
    logAudit(req, { action: 'create_patient', entityType: 'patient', entityId: id, patientId: id, newValue: { name, phone }, reason: '新增患者' });
    res.json({ id, name, phone, id_card });
  } catch (e) { next(e); }
});

app.get('/api/waitlist', authMiddleware, (req, res) => {
  const { slotId, status, patientId } = req.query;
  let sql = `
    SELECT w.*, p.name as patient_name, p.phone as patient_phone, p.id_card,
      d.name as doctor_name, d.department, s.date, s.period, s.time_start, s.time_end
    FROM waitlist w
    JOIN patients p ON w.patient_id = p.id
    JOIN slots s ON w.slot_id = s.id
    JOIN doctors d ON s.doctor_id = d.id
    WHERE 1=1
  `;
  const params = [];
  if (slotId) { sql += ' AND w.slot_id = ?'; params.push(slotId); }
  if (status) {
    if (status === 'active') sql += ' AND w.status IN (\'waiting\', \'notifying\')';
    else { sql += ' AND w.status = ?'; params.push(status); }
  }
  if (patientId) { sql += ' AND w.patient_id = ?'; params.push(patientId); }
  sql += ' ORDER BY s.date, s.id, w.position ASC';
  const list = db.prepare(sql).all(...params);
  res.json({ list });
});

app.get('/api/waitlist/slot/:slotId/next', authMiddleware, (req, res) => {
  const next = wl.getNextWaiter(req.params.slotId);
  res.json({ nextWaiter: next || null });
});

app.post('/api/waitlist', authMiddleware, (req, res, next) => {
  try {
    const { slotId, patientId } = req.body || {};
    if (!slotId || !patientId) return res.status(400).json({ error: 'slotId 和 patientId 必填' });
    const result = wl.addToWaitlist(req, { slotId: parseInt(slotId), patientId: parseInt(patientId) });
    res.json(result);
  } catch (e) { next(e); }
});

app.post('/api/waitlist/:id/opportunity', authMiddleware, (req, res, next) => {
  try {
    const { slotId } = req.body || {};
    if (!slotId) return res.status(400).json({ error: 'slotId 必填' });
    const result = wl.issueOpportunity(req, { slotId: parseInt(slotId), waitlistId: parseInt(req.params.id) });
    res.json(result);
  } catch (e) { next(e); }
});

app.post('/api/waitlist/slot/:slotId/issue-next', authMiddleware, (req, res, next) => {
  try {
    const result = wl.issueOpportunity(req, { slotId: parseInt(req.params.slotId) });
    res.json(result);
  } catch (e) { next(e); }
});

app.post('/api/waitlist/:id/confirm', authMiddleware, (req, res, next) => {
  try {
    const { slotId } = req.body || {};
    if (!slotId) return res.status(400).json({ error: 'slotId 必填' });
    const result = wl.confirmWaitlist(req, { slotId: parseInt(slotId), waitlistId: parseInt(req.params.id) });
    res.json(result);
  } catch (e) { next(e); }
});

app.post('/api/waitlist/:id/pass', authMiddleware, (req, res, next) => {
  try {
    const { slotId, reason } = req.body || {};
    if (!slotId) return res.status(400).json({ error: 'slotId 必填' });
    const result = wl.passWaitlist(req, { slotId: parseInt(slotId), waitlistId: parseInt(req.params.id), reason });
    res.json(result);
  } catch (e) { next(e); }
});

app.get('/api/notifications', authMiddleware, (req, res) => {
  const { slotId, waitlistId, type, limit, offset } = req.query;
  let sql = `
    SELECT n.*, p.name as patient_name, p.phone as patient_phone,
      d.name as doctor_name, s.date, s.period
    FROM notifications n
    JOIN patients p ON n.patient_id = p.id
    JOIN slots s ON n.slot_id = s.id
    JOIN doctors d ON s.doctor_id = d.id
    WHERE 1=1
  `;
  const params = [];
  if (slotId) { sql += ' AND n.slot_id = ?'; params.push(slotId); }
  if (waitlistId) { sql += ' AND n.waitlist_id = ?'; params.push(waitlistId); }
  if (type) { sql += ' AND n.type = ?'; params.push(type); }
  sql += ' ORDER BY n.sent_at DESC';
  const lim = parseInt(limit || '100', 10);
  const off = parseInt(offset || '0', 10);
  sql += ' LIMIT ? OFFSET ?';
  params.push(lim, off);
  const list = db.prepare(sql).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM notifications').get().c;
  res.json({ list, total });
});

app.get('/api/appointments', authMiddleware, (req, res) => {
  const { slotId, status } = req.query;
  let sql = `
    SELECT a.*, p.name as patient_name, p.phone, d.name as doctor_name, d.department,
      s.date, s.period, s.time_start, s.time_end
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    JOIN slots s ON a.slot_id = s.id
    JOIN doctors d ON s.doctor_id = d.id
    WHERE 1=1
  `;
  const params = [];
  if (slotId) { sql += ' AND a.slot_id = ?'; params.push(slotId); }
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  sql += ' ORDER BY a.created_at DESC LIMIT 200';
  const list = db.prepare(sql).all(...params);
  res.json({ list });
});

app.post('/api/appointments/:id/release-noshow', authMiddleware, (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const result = wl.releaseNoShow(req, { appointmentId: parseInt(req.params.id), reason });
    res.json(result);
  } catch (e) { next(e); }
});

app.get('/api/no-show-records', authMiddleware, (req, res) => {
  const { slotId, patientId, recovered } = req.query;
  let sql = `
    SELECT n.*, p.name as patient_name, p.phone,
      d.name as doctor_name, s.date, s.period,
      u.username as recovered_by_name
    FROM no_show_records n
    JOIN patients p ON n.patient_id = p.id
    JOIN slots s ON n.slot_id = s.id
    JOIN doctors d ON s.doctor_id = d.id
    LEFT JOIN users u ON n.recovered_by = u.id
    WHERE 1=1
  `;
  const params = [];
  if (slotId) { sql += ' AND n.slot_id = ?'; params.push(slotId); }
  if (patientId) { sql += ' AND n.patient_id = ?'; params.push(patientId); }
  if (recovered === 'true') sql += ' AND n.recovered_at IS NOT NULL';
  if (recovered === 'false') sql += ' AND n.recovered_at IS NULL';
  sql += ' ORDER BY n.created_at DESC LIMIT 200';
  const list = db.prepare(sql).all(...params);
  res.json({ list });
});

app.post('/api/no-show-records/:id/recover', authMiddleware, (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const result = wl.recoverNoShow(req, { recordId: parseInt(req.params.id), reason });
    res.json(result);
  } catch (e) { next(e); }
});

app.get('/api/config', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT key, value, updated_at, u.username as updated_by_name FROM config c LEFT JOIN users u ON c.updated_by = u.id').all();
  const config = {};
  rows.forEach(r => { config[r.key] = { value: r.value, updated_at: r.updated_at, updated_by: r.updated_by_name }; });
  res.json({ config });
});

app.put('/api/config', authMiddleware, requireConfigPermission, (req, res, next) => {
  try {
    const changes = req.body || {};
    const results = {};
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(changes)) {
        const existing = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
        if (existing) {
          db.prepare(`UPDATE config SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE key = ?`).run(String(value), req.user.id, key);
        } else {
          db.prepare(`INSERT INTO config (key, value, updated_at, updated_by) VALUES (?, ?, CURRENT_TIMESTAMP, ?)`).run(key, String(value), req.user.id);
        }
        results[key] = { old: existing?.value, new: String(value) };
      }
    });
    tx();
    logAudit(req, {
      action: 'update_config', entityType: 'config',
      newValue: results,
      reason: `更新配置项: ${Object.keys(changes).join(', ')}`
    });
    res.json({ updated: results });
  } catch (e) { next(e); }
});

app.get('/api/audit-logs', authMiddleware, requireAdmin, (req, res) => {
  const { entityType, action, userId, slotId, limit, offset } = req.query;
  let sql = `
    SELECT a.*, u.username as user_name
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];
  if (entityType) { sql += ' AND a.entity_type = ?'; params.push(entityType); }
  if (action) { sql += ' AND a.action = ?'; params.push(action); }
  if (userId) { sql += ' AND a.user_id = ?'; params.push(userId); }
  if (slotId) { sql += ' AND a.slot_id = ?'; params.push(slotId); }
  const whereStart = sql.indexOf('WHERE 1=1') + 8;
  const countSql = 'SELECT COUNT(*) c FROM audit_logs a WHERE 1=1' + sql.substring(whereStart);
  const total = db.prepare(countSql).get(...params).c;
  sql += ' ORDER BY a.created_at DESC';
  const lim = parseInt(limit || '200', 10);
  const off = parseInt(offset || '0', 10);
  sql += ' LIMIT ? OFFSET ?';
  params.push(lim, off);
  const logs = db.prepare(sql).all(...params).map(l => ({
    ...l,
    old_value: tryJson(l.old_value),
    new_value: tryJson(l.new_value)
  }));
  res.json({ list: logs, total });
});

app.get('/api/export/waitlist/:slotId', authMiddleware, (req, res) => {
  const slot = db.prepare(`SELECT s.*, d.name as doctor_name, d.department FROM slots s JOIN doctors d ON s.doctor_id = d.id WHERE s.id = ?`).get(req.params.slotId);
  if (!slot) return res.status(404).json({ error: '号源不存在' });
  const includeContact = wl.getConfig('export_include_contact_info') === 'true';
  const rows = db.prepare(`
    SELECT w.position, w.status, w.created_at, w.notified_at, w.notify_deadline, w.confirmed_at, w.expired_at, w.passed_at,
      p.name as patient_name, ${includeContact ? 'p.phone, p.id_card,' : ''}
      s.date, s.period, d.name as doctor_name, d.department
    FROM waitlist w
    JOIN patients p ON w.patient_id = p.id
    JOIN slots s ON w.slot_id = s.id
    JOIN doctors d ON s.doctor_id = d.id
    WHERE w.slot_id = ?
    ORDER BY w.position ASC, w.created_at ASC
  `).all(req.params.slotId);

  logAudit(req, {
    action: 'export_waitlist', entityType: 'slot', entityId: slot.id,
    slotId: slot.id, newValue: { recordCount: rows.length, includeContact },
    reason: `导出号源 ${slot.date} ${slot.period} ${slot.doctor_name} 的候补名单`
  });

  const headers = includeContact
    ? ['排名', '状态', '患者姓名', '电话', '身份证', '加入时间', '通知时间', '截止时间', '确认时间', '过期时间', '过号时间']
    : ['排名', '状态', '患者姓名', '加入时间', '通知时间', '截止时间', '确认时间', '过期时间', '过号时间'];
  const lines = [headers.join(',')];
  const statusMap = { waiting: '等候中', notifying: '待确认', confirmed: '已确认', passed: '已过号', expired: '已过期', cancelled: '已取消' };
  for (const r of rows) {
    const row = includeContact
      ? [r.position, statusMap[r.status] || r.status, r.patient_name, r.phone, r.id_card || '', r.created_at || '', r.notified_at || '', r.notify_deadline || '', r.confirmed_at || '', r.expired_at || '', r.passed_at || '']
      : [r.position, statusMap[r.status] || r.status, r.patient_name, r.created_at || '', r.notified_at || '', r.notify_deadline || '', r.confirmed_at || '', r.expired_at || '', r.passed_at || ''];
    lines.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  const csv = '\uFEFF' + lines.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="waitlist_slot_${slot.id}_${slot.date}.csv"`);
  res.send(csv);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: timeCtrl.formatDateTime(timeCtrl.getCurrentTime()) }));

app.use(errorHandler);

db.ready.then(() => {
  db.initTables();
  setInterval(() => {
    try {
      const expired = wl.checkAndProcessExpired();
      if (expired.length > 0) {
        console.log(`[系统] 自动处理了 ${expired.length} 条超时候补记录`);
      }
    } catch (e) {
      console.error('[系统] 超时处理任务异常:', e);
    }
  }, 1000);
  app.listen(PORT, () => {
    console.log(`[服务] 门诊候补号源与爽约恢复系统 后端服务已启动: http://localhost:${PORT}`);
    console.log(`[服务] 默认用户: admin/admin123, clerk1/clerk123`);
    console.log(`[服务] 健康检查: http://localhost:${PORT}/api/health`);
  });
}).catch(err => {
  console.error('[服务] 启动失败:', err);
  process.exit(1);
});

module.exports = app;
