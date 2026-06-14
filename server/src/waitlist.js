const db = require('./db');
const { logAudit } = require('./audit');
const { getCurrentTime, addSeconds, formatDateTime, diffSeconds } = require('./time');

const getConfig = (key) => {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
};

const getIntConfig = (key, def = 0) => {
  const v = getConfig(key);
  return v !== null ? parseInt(v, 10) : def;
};

const createNotification = (tx, waitlistId, slotId, patientId, type, message) => {
  tx.prepare(`
    INSERT INTO notifications (waitlist_id, slot_id, patient_id, type, message, status, sent_at)
    VALUES (?, ?, ?, ?, ?, 'sent', CURRENT_TIMESTAMP)
  `).run(waitlistId, slotId, patientId, type, message);
};

const renumberWaitlist = (tx, slotId) => {
  const rows = tx.prepare(`
    SELECT id FROM waitlist
    WHERE slot_id = ? AND status IN ('waiting', 'notifying')
    ORDER BY position ASC, created_at ASC
  `).all(slotId);
  const updatePos = tx.prepare('UPDATE waitlist SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  rows.forEach((row, idx) => {
    updatePos.run(idx + 1, row.id);
  });
  return rows.length;
};

const getNextWaiter = (slotId) => {
  return db.prepare(`
    SELECT w.*, p.name as patient_name, p.phone as patient_phone
    FROM waitlist w
    JOIN patients p ON w.patient_id = p.id
    WHERE w.slot_id = ? AND w.status = 'waiting'
    ORDER BY w.position ASC, w.created_at ASC
    LIMIT 1
  `).get(slotId);
};

const addToWaitlist = (req, { slotId, patientId }) => {
  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
  if (!slot) {
    throw new Error('号源不存在');
  }
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patient) {
    throw new Error('患者不存在');
  }

  const existing = db.prepare(`
    SELECT id, status FROM waitlist WHERE slot_id = ? AND patient_id = ?
  `).get(slotId, patientId);

  if (existing) {
    if (['waiting', 'notifying'].includes(existing.status)) {
      throw new Error('该患者已在候补队列中，无需重复加入');
    }
    if (existing.status === 'confirmed') {
      throw new Error('该患者已确认占号，无法重复加入候补');
    }
  }

  const tx = db.transaction(() => {
    const waitingCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM waitlist
      WHERE slot_id = ? AND status IN ('waiting', 'notifying')
    `).get(slotId).cnt;

    const newPosition = waitingCount + 1;
    const now = formatDateTime(getCurrentTime());

    if (existing) {
      db.prepare(`
        UPDATE waitlist SET position = ?, status = 'waiting',
          notify_deadline = NULL, notified_at = NULL, confirmed_at = NULL,
          expired_at = NULL, passed_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(newPosition, now, existing.id);

      if (req) {
        logAudit(req, {
          action: 'rejoin_waitlist',
          entityType: 'waitlist',
          entityId: existing.id,
          slotId,
          waitlistId: existing.id,
          patientId,
          newValue: { position: newPosition, status: 'waiting' },
          reason: '患者重新加入候补队列'
        });
      }
      return { waitlistId: existing.id, position: newPosition, rejoined: true };
    }

    const stmt = db.prepare(`
      INSERT INTO waitlist (slot_id, patient_id, position, status, created_at, updated_at)
      VALUES (?, ?, ?, 'waiting', ?, ?)
    `);
    const result = stmt.run(slotId, patientId, newPosition, now, now);
    const waitlistId = result.lastInsertRowid;

    if (req) {
      logAudit(req, {
        action: 'join_waitlist',
        entityType: 'waitlist',
        entityId: waitlistId,
        slotId,
        waitlistId,
        patientId,
        newValue: { position: newPosition, status: 'waiting' },
        reason: '患者加入候补队列'
      });
    }
    return { waitlistId, position: newPosition, rejoined: false };
  });

  return tx();
};

const issueOpportunity = (req, { slotId, waitlistId }) => {
  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
  if (!slot) throw new Error('号源不存在');

  let waiter;
  if (waitlistId) {
    waiter = db.prepare(`
      SELECT w.*, p.name as patient_name, p.phone as patient_phone
      FROM waitlist w JOIN patients p ON w.patient_id = p.id
      WHERE w.id = ? AND w.slot_id = ?
    `).get(waitlistId, slotId);
  } else {
    waiter = getNextWaiter(slotId);
  }

  if (!waiter) {
    throw new Error('没有可发放确认机会的候补患者');
  }
  if (!['waiting', 'expired', 'passed'].includes(waiter.status)) {
    if (waiter.status === 'notifying') {
      throw new Error('该候补患者正在确认流程中');
    }
    if (waiter.status === 'confirmed') {
      throw new Error('该候补患者已确认占号');
    }
    throw new Error(`该候补患者状态(${waiter.status})不可发放确认机会`);
  }

  const timeoutSec = getIntConfig('waitlist_timeout_seconds', 180);
  const now = getCurrentTime();
  const deadline = addSeconds(now, timeoutSec);
  const nowStr = formatDateTime(now);
  const deadlineStr = formatDateTime(deadline);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE waitlist SET
        status = 'notifying',
        notify_deadline = ?,
        notified_at = ?,
        expired_at = NULL,
        confirmed_at = NULL,
        passed_at = NULL,
        updated_at = ?
      WHERE id = ?
    `).run(deadlineStr, nowStr, nowStr, waiter.id);

    const message = `${waiter.patient_name}您好，您候补的号源有确认机会，请在${Math.floor(timeoutSec/60)}分${timeoutSec%60}秒内完成确认。超时将过号处理。`;
    createNotification(db, waiter.id, slotId, waiter.patient_id, 'opportunity', message);

    if (req) {
      logAudit(req, {
        action: 'issue_opportunity',
        entityType: 'waitlist',
        entityId: waiter.id,
        slotId,
        waitlistId: waiter.id,
        patientId: waiter.patient_id,
        oldValue: { status: waiter.status },
        newValue: { status: 'notifying', notify_deadline: deadlineStr },
        reason: '发放确认机会'
      });
    }

    return {
      waitlistId: waiter.id,
      patientId: waiter.patient_id,
      patientName: waiter.patient_name,
      status: 'notifying',
      notifyDeadline: deadlineStr,
      notifiedAt: nowStr,
      timeoutSeconds: timeoutSec
    };
  });

  return tx();
};

const confirmWaitlist = (req, { slotId, waitlistId }) => {
  const waiter = db.prepare(`
    SELECT w.*, p.name as patient_name FROM waitlist w
    JOIN patients p ON w.patient_id = p.id
    WHERE w.id = ? AND w.slot_id = ?
  `).get(waitlistId, slotId);
  if (!waiter) throw new Error('候补记录不存在');

  if (waiter.status !== 'notifying') {
    if (waiter.status === 'confirmed') {
      throw new Error('该候补已确认占号，无需重复确认');
    }
    if (waiter.status === 'expired') {
      throw new Error('确认超时已过期，需重新发放机会');
    }
    throw new Error(`当前状态(${waiter.status})不能确认，请先发放确认机会`);
  }

  const now = getCurrentTime();
  const deadline = new Date(waiter.notify_deadline);
  if (now > deadline) {
    throw new Error('确认时间已超时，无法确认');
  }

  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
  if (!slot) throw new Error('号源不存在');
  if (slot.available_count <= 0) {
    throw new Error('号源已无可用名额');
  }

  const nowStr = formatDateTime(now);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE waitlist SET status = 'confirmed', confirmed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nowStr, nowStr, waitlistId);

    db.prepare(`
      UPDATE slots SET available_count = available_count - 1,
        status = CASE WHEN (available_count - 1) <= 0 THEN 'full' ELSE status END
      WHERE id = ?
    `).run(slotId);

    const existingAppt = db.prepare(`
      SELECT id FROM appointments WHERE slot_id = ? AND patient_id = ?
    `).get(slotId, waiter.patient_id);
    if (existingAppt) {
      db.prepare(`
        UPDATE appointments SET status = 'confirmed', updated_at = ? WHERE id = ?
      `).run(nowStr, existingAppt.id);
    } else {
      db.prepare(`
        INSERT INTO appointments (slot_id, patient_id, status, created_at, updated_at)
        VALUES (?, ?, 'confirmed', ?, ?)
      `).run(slotId, waiter.patient_id, nowStr, nowStr);
    }

    const message = `${waiter.patient_name}您好，候补号源确认成功！请按时就诊。`;
    createNotification(db, waitlistId, slotId, waiter.patient_id, 'confirmed', message);

    renumberWaitlist(db, slotId);

    if (req) {
      logAudit(req, {
        action: 'confirm_waitlist',
        entityType: 'waitlist',
        entityId: waitlistId,
        slotId,
        waitlistId,
        patientId: waiter.patient_id,
        oldValue: { status: 'notifying' },
        newValue: { status: 'confirmed' },
        reason: '候补确认占号'
      });
    }

    return {
      waitlistId,
      patientId: waiter.patient_id,
      patientName: waiter.patient_name,
      status: 'confirmed',
      confirmedAt: nowStr
    };
  });

  return tx();
};

const passWaitlist = (req, { slotId, waitlistId, reason }) => {
  const waiter = db.prepare(`
    SELECT w.*, p.name as patient_name FROM waitlist w
    JOIN patients p ON w.patient_id = p.id
    WHERE w.id = ? AND w.slot_id = ?
  `).get(waitlistId, slotId);
  if (!waiter) throw new Error('候补记录不存在');

  if (!['waiting', 'notifying'].includes(waiter.status)) {
    if (waiter.status === 'passed') {
      throw new Error('该候补已被过号');
    }
    throw new Error(`当前状态(${waiter.status})不能过号`);
  }

  const now = getCurrentTime();
  const nowStr = formatDateTime(now);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE waitlist SET status = 'passed', passed_at = ?, updated_at = ? WHERE id = ?
    `).run(nowStr, nowStr, waitlistId);

    const message = `${waiter.patient_name}您好，由于${reason || '您未及时响应'}，您的候补机会已过号处理。`;
    createNotification(db, waitlistId, slotId, waiter.patient_id, 'passed', message);

    renumberWaitlist(db, slotId);

    if (req) {
      logAudit(req, {
        action: 'pass_waitlist',
        entityType: 'waitlist',
        entityId: waitlistId,
        slotId,
        waitlistId,
        patientId: waiter.patient_id,
        oldValue: { status: waiter.status },
        newValue: { status: 'passed' },
        reason: reason || '过号处理'
      });
    }

    return { waitlistId, status: 'passed', passedAt: nowStr };
  });

  return tx();
};

const checkAndProcessExpired = () => {
  const now = getCurrentTime();
  const nowStr = formatDateTime(now);

  const expired = db.prepare(`
    SELECT w.* FROM waitlist w
    WHERE w.status = 'notifying'
      AND w.notify_deadline IS NOT NULL
      AND DATETIME(w.notify_deadline) <= DATETIME(?)
  `).all(nowStr);

  if (expired.length === 0) return [];

  const results = [];
  const tx = db.transaction(() => {
    for (const waiter of expired) {
      db.prepare(`
        UPDATE waitlist SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ?
      `).run(nowStr, nowStr, waiter.id);

      const message = `候补确认超时，您的候补机会已过期。`;
      createNotification(db, waiter.id, waiter.slot_id, waiter.patient_id, 'expired', message);

      db.prepare(`
        INSERT INTO no_show_records (slot_id, patient_id, waitlist_id, reason)
        VALUES (?, ?, ?, ?)
      `).run(waiter.slot_id, waiter.patient_id, waiter.id, '候补确认超时未响应');

      logAudit(null, {
        action: 'expire_waitlist',
        entityType: 'waitlist',
        entityId: waiter.id,
        slotId: waiter.slot_id,
        waitlistId: waiter.id,
        patientId: waiter.patient_id,
        oldValue: { status: 'notifying' },
        newValue: { status: 'expired' },
        reason: '确认超时自动过期'
      });

      renumberWaitlist(db, waiter.slot_id);

      results.push({ waitlistId: waiter.id, slotId: waiter.slot_id, status: 'expired' });

      const autoRecover = getConfig('auto_recover_enabled') === 'true';
      const strategy = getConfig('recovery_strategy');
      if (autoRecover && strategy === 'auto_next') {
        const next = getNextWaiter(waiter.slot_id);
        if (next) {
          try {
            issueOpportunity(null, { slotId: waiter.slot_id, waitlistId: next.id });
          } catch (e) {
            console.error('自动发放下一位失败:', e.message);
          }
        }
      }
    }
  });
  tx();
  return results;
};

const releaseNoShow = (req, { appointmentId, reason }) => {
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
  if (!appt) throw new Error('预约记录不存在');
  if (['cancelled', 'no_show'].includes(appt.status)) {
    throw new Error('该预约已处理');
  }

  const now = getCurrentTime();
  const nowStr = formatDateTime(now);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE appointments SET status = 'no_show', updated_at = ? WHERE id = ?
    `).run(nowStr, appointmentId);

    db.prepare(`
      UPDATE slots SET available_count = available_count + 1,
        status = CASE WHEN status = 'full' AND (available_count + 1) > 0 THEN 'active' ELSE status END
      WHERE id = ?
    `).run(appt.slot_id);

    db.prepare(`
      INSERT INTO no_show_records (slot_id, patient_id, appointment_id, reason)
      VALUES (?, ?, ?, ?)
    `).run(appt.slot_id, appt.patient_id, appointmentId, reason || '患者爽约');

    if (req) {
      logAudit(req, {
        action: 'release_noshow',
        entityType: 'appointment',
        entityId: appointmentId,
        slotId: appt.slot_id,
        patientId: appt.patient_id,
        oldValue: { status: appt.status },
        newValue: { status: 'no_show' },
        reason: reason || '患者爽约释放号源'
      });
    }

    const autoRecover = getConfig('auto_recover_enabled') === 'true';
    const strategy = getConfig('recovery_strategy');
    let result = { appointmentId, status: 'no_show', slotReleased: true };

    if (autoRecover && strategy === 'auto_next') {
      const next = getNextWaiter(appt.slot_id);
      if (next) {
        try {
          const opp = issueOpportunity(req, { slotId: appt.slot_id, waitlistId: next.id });
          result.nextIssued = opp;
        } catch (e) {
          console.error('自动发放下一位失败:', e.message);
        }
      }
    }
    return result;
  });

  return tx();
};

const recoverNoShow = (req, { recordId, reason }) => {
  const record = db.prepare('SELECT * FROM no_show_records WHERE id = ?').get(recordId);
  if (!record) throw new Error('爽约记录不存在');
  if (record.recovered_at) throw new Error('该爽约记录已被恢复');

  if (!reason && req?.user?.role !== 'admin') {
    throw new Error('恢复爽约必须提供原因（管理员除外）');
  }

  const now = getCurrentTime();
  const nowStr = formatDateTime(now);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE no_show_records SET
        recovered_at = ?,
        recovered_by = ?,
        recovery_reason = ?
      WHERE id = ?
    `).run(nowStr, req?.user?.id ?? null, reason || '（无原因恢复）', recordId);

    if (record.appointment_id) {
      db.prepare(`
        UPDATE appointments SET status = 'confirmed', updated_at = ? WHERE id = ?
      `).run(nowStr, record.appointment_id);

      db.prepare(`
        UPDATE slots SET available_count = MAX(0, available_count - 1),
          status = CASE WHEN (available_count - 1) <= 0 THEN 'full' ELSE status END
        WHERE id = ?
      `).run(record.slot_id);
    }

    if (record.waitlist_id) {
      db.prepare(`
        UPDATE waitlist SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?
      `).run(nowStr, nowStr, record.waitlist_id);
    }

    const patient = db.prepare('SELECT name FROM patients WHERE id = ?').get(record.patient_id);
    const pname = patient?.name || '患者';
    const message = `${pname}您好，您的爽约记录已恢复，预约继续有效。`;
    createNotification(db, record.waitlist_id || 0, record.slot_id, record.patient_id, 'recovered', message);

    if (req) {
      logAudit(req, {
        action: 'recover_noshow',
        entityType: 'no_show_record',
        entityId: recordId,
        slotId: record.slot_id,
        patientId: record.patient_id,
        oldValue: { recovered: false },
        newValue: { recovered: true, recoveryReason: reason || '（无原因恢复）' },
        reason: reason || '恢复爽约记录'
      });
    }

    return {
      recordId,
      recoveredAt: nowStr,
      recoveryReason: reason || '（无原因恢复）'
    };
  });

  return tx();
};

module.exports = {
  getConfig,
  getIntConfig,
  getNextWaiter,
  addToWaitlist,
  issueOpportunity,
  confirmWaitlist,
  passWaitlist,
  checkAndProcessExpired,
  releaseNoShow,
  recoverNoShow,
  renumberWaitlist
};
