const db = require('./db');

function generateBatchNo() {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `RES${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${rand}`;
}

const dao = {
  getConfig(key) {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  createBatch(title, reason, createdBy, remarks) {
    const batchNo = generateBatchNo();
    const r = db.prepare(`
      INSERT INTO reschedule_batches (batch_no, title, reason, status, created_by, remarks)
      VALUES (?, ?, ?, 'draft', ?, ?)
    `).run(batchNo, title, reason || null, createdBy, remarks || null);
    return { id: r.lastInsertRowid, batch_no: batchNo, title, reason, status: 'draft', created_by: createdBy, remarks };
  },

  getBatchById(id) {
    return db.prepare(`
      SELECT b.*, u.username as created_by_name,
        u2.username as executed_by_name,
        u3.username as revoked_by_name
      FROM reschedule_batches b
      LEFT JOIN users u ON b.created_by = u.id
      LEFT JOIN users u2 ON b.executed_by = u2.id
      LEFT JOIN users u3 ON b.revoked_by = u3.id
      WHERE b.id = ?
    `).get(id);
  },

  listBatches(status) {
    let sql = `
      SELECT b.*,
        (SELECT COUNT(*) FROM reschedule_items i WHERE i.batch_id = b.id) as total_items,
        (SELECT COUNT(*) FROM reschedule_items i WHERE i.batch_id = b.id AND i.status = 'success') as success_count,
        (SELECT COUNT(*) FROM reschedule_items i WHERE i.batch_id = b.id AND i.status = 'failed') as failed_count,
        u.username as created_by_name
      FROM reschedule_batches b
      LEFT JOIN users u ON b.created_by = u.id
    `;
    const params = [];
    if (status) {
      sql += ' WHERE b.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY b.created_at DESC';
    return db.prepare(sql).all(...params);
  },

  updateBatchStatus(batchId, status, userId) {
    const now = new Date().toISOString();
    if (status === 'executing' || status === 'completed') {
      db.prepare(`
        UPDATE reschedule_batches SET status = ?, executed_by = ?, executed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, userId, batchId);
    } else if (status === 'revoked') {
      db.prepare(`
        UPDATE reschedule_batches SET status = ?, revoked_by = ?, revoked_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, userId, batchId);
    } else {
      db.prepare('UPDATE reschedule_batches SET status = ? WHERE id = ?').run(status, batchId);
    }
  },

  addItem(batchId, sourceType, sourceId, patientId, sourceSlotId) {
    const r = db.prepare(`
      INSERT INTO reschedule_items (batch_id, source_type, source_id, patient_id, source_slot_id, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(batchId, sourceType, sourceId, patientId, sourceSlotId);
    return r.lastInsertRowid;
  },

  clearItems(batchId) {
    db.prepare('DELETE FROM reschedule_items WHERE batch_id = ?').run(batchId);
  },

  getItemsByBatch(batchId) {
    return db.prepare(`
      SELECT i.*,
        p.name as patient_name, p.phone as patient_phone,
        s.date as source_date, s.period as source_period,
        s.time_start as source_time_start, s.time_end as source_time_end,
        d.name as source_doctor_name, d.department as source_department,
        ts.date as target_date, ts.period as target_period,
        td.name as target_doctor_name, td.department as target_department
      FROM reschedule_items i
      JOIN patients p ON i.patient_id = p.id
      JOIN slots s ON i.source_slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      LEFT JOIN slots ts ON i.target_slot_id = ts.id
      LEFT JOIN doctors td ON ts.doctor_id = td.id
      WHERE i.batch_id = ?
      ORDER BY i.id ASC
    `).all(batchId);
  },

  updateItemTarget(itemId, targetSlotId) {
    db.prepare('UPDATE reschedule_items SET target_slot_id = ? WHERE id = ?').run(targetSlotId, itemId);
  },

  updateItemStatus(itemId, status, resultMessage, conflictType, conflictDetail) {
    db.prepare(`
      UPDATE reschedule_items SET status = ?, result_message = ?, conflict_type = ?, conflict_detail = ?, processed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, resultMessage || null, conflictType || null, conflictDetail || null, itemId);
  },

  updateItemSuccess(itemId, newAppointmentId, newWaitlistId, oldApptStatus, oldWaitStatus) {
    db.prepare(`
      UPDATE reschedule_items SET status = 'success',
        new_appointment_id = ?, new_waitlist_id = ?,
        old_appointment_status = ?, old_waitlist_status = ?,
        processed_at = CURRENT_TIMESTAMP, result_message = '改期成功'
      WHERE id = ?
    `).run(newAppointmentId || null, newWaitlistId || null, oldApptStatus || null, oldWaitStatus || null, itemId);
  },

  addResult(batchId, itemId, patientId, sourceSlotId, targetSlotId, sourceType, result, errorMessage, rollbackSnapshot) {
    const r = db.prepare(`
      INSERT INTO reschedule_results (batch_id, item_id, patient_id, source_slot_id, target_slot_id, source_type, result, error_message, rollback_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, itemId, patientId, sourceSlotId, targetSlotId || null, sourceType, result, errorMessage || null, rollbackSnapshot ? JSON.stringify(rollbackSnapshot) : null);
    return r.lastInsertRowid;
  },

  getResultsByBatch(batchId) {
    return db.prepare(`
      SELECT r.*,
        p.name as patient_name, p.phone as patient_phone,
        s.date as source_date, s.period as source_period,
        d.name as source_doctor_name, d.department as source_department,
        ts.date as target_date, ts.period as target_period,
        td.name as target_doctor_name
      FROM reschedule_results r
      JOIN patients p ON r.patient_id = p.id
      JOIN slots s ON r.source_slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      LEFT JOIN slots ts ON r.target_slot_id = ts.id
      LEFT JOIN doctors td ON ts.doctor_id = td.id
      WHERE r.batch_id = ?
      ORDER BY r.id ASC
    `).all(batchId);
  },

  addNotification(batchId, patientId, appointmentId, waitlistId, notifType, content) {
    db.prepare(`
      INSERT INTO reschedule_notifications (batch_id, patient_id, appointment_id, waitlist_id, notification_type, content, sent, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).run(batchId, patientId, appointmentId || null, waitlistId || null, notifType, content);
  },

  getNotificationsByBatch(batchId) {
    return db.prepare(`
      SELECT n.*, p.name as patient_name, p.phone as patient_phone
      FROM reschedule_notifications n
      JOIN patients p ON n.patient_id = p.id
      WHERE n.batch_id = ?
      ORDER BY n.created_at DESC
    `).all(batchId);
  },

  addExportRecord(batchId, exportType, filePath, fileName, recordCount, createdBy) {
    const r = db.prepare(`
      INSERT INTO reschedule_exports (batch_id, export_type, file_path, file_name, record_count, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(batchId || null, exportType, filePath, fileName, recordCount || null, createdBy);
    return r.lastInsertRowid;
  },

  getExportRecords(batchId) {
    let sql = `
      SELECT e.*, u.username as created_by_name
      FROM reschedule_exports e
      LEFT JOIN users u ON e.created_by = u.id
    `;
    const params = [];
    if (batchId) {
      sql += ' WHERE e.batch_id = ?';
      params.push(batchId);
    }
    sql += ' ORDER BY e.created_at DESC';
    return db.prepare(sql).all(...params);
  },

  addRevocation(batchId, reason, restoredAppointments, restoredWaitlist, restoredSlots, createdBy) {
    const r = db.prepare(`
      INSERT INTO reschedule_revocations (batch_id, reason, restored_appointments, restored_waitlist, restored_slots, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(batchId, reason || null, restoredAppointments || 0, restoredWaitlist || 0, restoredSlots || 0, createdBy);
    return r.lastInsertRowid;
  },

  findSlotsByDateAndDoctor(date, doctorId, department) {
    let sql = `
      SELECT s.*, d.name as doctor_name, d.department, d.title,
        (SELECT COUNT(*) FROM appointments a WHERE a.slot_id = s.id AND a.status IN ('booked', 'confirmed')) as booked_count
      FROM slots s
      JOIN doctors d ON s.doctor_id = d.id
      WHERE s.status = 'active'
    `;
    const params = [];
    if (date) {
      sql += ' AND s.date = ?';
      params.push(date);
    }
    if (doctorId) {
      sql += ' AND s.doctor_id = ?';
      params.push(doctorId);
    }
    if (department) {
      sql += ' AND d.department = ?';
      params.push(department);
    }
    sql += ' ORDER BY s.date, s.doctor_id, CASE s.period WHEN "morning" THEN 1 WHEN "afternoon" THEN 2 ELSE 3 END';
    return db.prepare(sql).all(...params);
  },

  getSlotWithDetail(slotId) {
    return db.prepare(`
      SELECT s.*, d.name as doctor_name, d.department, d.title,
        (SELECT COUNT(*) FROM appointments a WHERE a.slot_id = s.id AND a.status IN ('booked', 'confirmed')) as booked_count
      FROM slots s
      JOIN doctors d ON s.doctor_id = d.id
      WHERE s.id = ?
    `).get(slotId);
  },

  getAppointmentById(appointmentId) {
    return db.prepare(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone,
        s.date, s.period, s.time_start, s.time_end,
        d.name as doctor_name, d.department
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN slots s ON a.slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      WHERE a.id = ?
    `).get(appointmentId);
  },

  getWaitlistById(waitlistId) {
    return db.prepare(`
      SELECT w.*, p.name as patient_name, p.phone as patient_phone,
        s.date, s.period, s.time_start, s.time_end,
        d.name as doctor_name, d.department
      FROM waitlist w
      JOIN patients p ON w.patient_id = p.id
      JOIN slots s ON w.slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      WHERE w.id = ?
    `).get(waitlistId);
  },

  getActiveAppointmentsBySlot(slotId) {
    return db.prepare(`
      SELECT a.*, p.name as patient_name, p.phone as patient_phone
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE a.slot_id = ? AND a.status IN ('booked', 'confirmed')
      ORDER BY a.created_at ASC
    `).all(slotId);
  },

  getActiveWaitlistBySlot(slotId) {
    return db.prepare(`
      SELECT w.*, p.name as patient_name, p.phone as patient_phone
      FROM waitlist w
      JOIN patients p ON w.patient_id = p.id
      WHERE w.slot_id = ? AND w.status IN ('waiting', 'notifying')
      ORDER BY w.position ASC, w.created_at ASC
    `).all(slotId);
  },

  checkPatientDuplicateInSlot(patientId, slotId, excludeAppointmentId) {
    let sql = `
      SELECT COUNT(*) as cnt FROM appointments
      WHERE patient_id = ? AND slot_id = ? AND status IN ('booked', 'confirmed')
    `;
    const params = [patientId, slotId];
    if (excludeAppointmentId) {
      sql += ' AND id != ?';
      params.push(excludeAppointmentId);
    }
    return db.prepare(sql).get(...params).cnt > 0;
  },

  checkSlotSuspended(slotId) {
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM suspension_affected_slots
      WHERE slot_id = ? AND locked = 1
        AND batch_id IN (SELECT id FROM suspension_batches WHERE status IN ('pending', 'executing', 'completed'))
    `).get(slotId);
    return row.cnt > 0;
  },

  getRevocationByBatch(batchId) {
    return db.prepare(`
      SELECT r.*, u.username as created_by_name
      FROM reschedule_revocations r
      LEFT JOIN users u ON r.created_by = u.id
      WHERE r.batch_id = ?
      ORDER BY r.created_at DESC
      LIMIT 1
    `).get(batchId);
  }
};

module.exports = dao;
