const db = require('./db');

function generateBatchNo() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `SUS${dateStr}${random}`;
}

const dao = {
  createBatch(title, reason, createdBy, remarks) {
    const batchNo = generateBatchNo();
    const stmt = db.prepare(`
      INSERT INTO suspension_batches (batch_no, title, reason, created_by, remarks, status)
      VALUES (?, ?, ?, ?, ?, 'draft')
    `);
    const result = stmt.run(batchNo, title, reason, createdBy, remarks || null);
    return dao.getBatchById(result.lastInsertRowid);
  },

  getBatchById(id) {
    return db.prepare('SELECT * FROM suspension_batches WHERE id = ?').get(id);
  },

  getBatchByNo(batchNo) {
    return db.prepare('SELECT * FROM suspension_batches WHERE batch_no = ?').get(batchNo);
  },

  listBatches(status = null) {
    if (status) {
      return db.prepare('SELECT * FROM suspension_batches WHERE status = ? ORDER BY created_at DESC').all(status);
    }
    return db.prepare('SELECT * FROM suspension_batches ORDER BY created_at DESC').all();
  },

  updateBatchStatus(id, status, userId) {
    const now = new Date().toISOString();
    if (status === 'completed') {
      return db.prepare(`
        UPDATE suspension_batches SET status = ?, executed_by = ?, executed_at = ? WHERE id = ?
      `).run(status, userId, now, id);
    } else if (status === 'revoked') {
      return db.prepare(`
        UPDATE suspension_batches SET status = ?, revoked_by = ?, revoked_at = ? WHERE id = ?
      `).run(status, userId, now, id);
    }
    return db.prepare('UPDATE suspension_batches SET status = ? WHERE id = ?').run(status, id);
  },

  addItem(batchId, itemType, itemValue, description) {
    return db.prepare(`
      INSERT INTO suspension_items (batch_id, item_type, item_value, description)
      VALUES (?, ?, ?, ?)
    `).run(batchId, itemType, itemValue, description);
  },

  getItemsByBatch(batchId) {
    return db.prepare('SELECT * FROM suspension_items WHERE batch_id = ?').all(batchId);
  },

  clearItems(batchId) {
    return db.prepare('DELETE FROM suspension_items WHERE batch_id = ?').run(batchId);
  },

  findSlotsByCriteria(date = null, doctorId = null, room = null) {
    let sql = `
      SELECT s.*, d.name AS doctor_name, d.department
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
    return db.prepare(sql).all(...params);
  },

  checkSlotConflict(slotIds, excludeBatchId = null) {
    let sql = `
      SELECT DISTINCT s.slot_id, b.batch_no, b.title, b.status
      FROM suspension_affected_slots s
      JOIN suspension_batches b ON s.batch_id = b.id
      WHERE s.slot_id IN (${slotIds.map(() => '?').join(',')})
      AND b.status IN ('draft', 'pending', 'executing')
    `;
    const params = [...slotIds];
    if (excludeBatchId) {
      sql += ' AND s.batch_id != ?';
      params.push(excludeBatchId);
    }
    return db.prepare(sql).all(...params);
  },

  addAffectedSlot(batchId, slotId) {
    return db.prepare(`
      INSERT OR IGNORE INTO suspension_affected_slots (batch_id, slot_id, locked)
      VALUES (?, ?, 1)
    `).run(batchId, slotId);
  },

  getAffectedSlots(batchId) {
    return db.prepare(`
      SELECT s.*, sl.doctor_id, sl.date, sl.period, sl.time_start, sl.time_end, d.name AS doctor_name, d.department
      FROM suspension_affected_slots s
      JOIN slots sl ON s.slot_id = sl.id
      JOIN doctors d ON sl.doctor_id = d.id
      WHERE s.batch_id = ?
    `).all(batchId);
  },

  clearAffectedSlots(batchId) {
    return db.prepare('DELETE FROM suspension_affected_slots WHERE batch_id = ?').run(batchId);
  },

  getConfirmedAppointments(slotIds) {
    return db.prepare(`
      SELECT a.*, p.name AS patient_name, p.phone, sl.date, sl.period, d.name AS doctor_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN slots sl ON a.slot_id = sl.id
      JOIN doctors d ON sl.doctor_id = d.id
      WHERE a.slot_id IN (${slotIds.map(() => '?').join(',')})
      AND a.status = 'confirmed'
    `).all(...slotIds);
  },

  getActiveWaitlist(slotIds) {
    return db.prepare(`
      SELECT w.*, p.name AS patient_name, p.phone, sl.date, sl.period, d.name AS doctor_name
      FROM waitlist w
      JOIN patients p ON w.patient_id = p.id
      JOIN slots sl ON w.slot_id = sl.id
      JOIN doctors d ON sl.doctor_id = d.id
      WHERE w.slot_id IN (${slotIds.map(() => '?').join(',')})
      AND w.status IN ('waiting', 'notifying')
    `).all(...slotIds);
  },

  addAffectedAppointment(batchId, slotId, appointmentId, patientId, oldStatus, notificationContent) {
    return db.prepare(`
      INSERT INTO suspension_affected_appointments 
      (batch_id, slot_id, appointment_id, patient_id, old_status, notification_content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(batchId, slotId, appointmentId, patientId, oldStatus, notificationContent);
  },

  addAffectedWaitlist(batchId, slotId, waitlistId, patientId, oldStatus, notificationContent) {
    return db.prepare(`
      INSERT INTO suspension_affected_waitlist 
      (batch_id, slot_id, waitlist_id, patient_id, old_status, notification_content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(batchId, slotId, waitlistId, patientId, oldStatus, notificationContent);
  },

  getAffectedAppointments(batchId) {
    return db.prepare(`
      SELECT sa.*, p.name AS patient_name, p.phone, p.id_card,
             sl.date, sl.period, sl.time_start, d.name AS doctor_name
      FROM suspension_affected_appointments sa
      JOIN patients p ON sa.patient_id = p.id
      JOIN slots sl ON sa.slot_id = sl.id
      JOIN doctors d ON sl.doctor_id = d.id
      WHERE sa.batch_id = ?
      ORDER BY sl.date, sl.period
    `).all(batchId);
  },

  getAffectedWaitlist(batchId) {
    return db.prepare(`
      SELECT sw.*, p.name AS patient_name, p.phone, p.id_card,
             sl.date, sl.period, sl.time_start, d.name AS doctor_name
      FROM suspension_affected_waitlist sw
      JOIN patients p ON sw.patient_id = p.id
      JOIN slots sl ON sw.slot_id = sl.id
      JOIN doctors d ON sl.doctor_id = d.id
      WHERE sw.batch_id = ?
      ORDER BY sl.date, sl.period, sw.id
    `).all(batchId);
  },

  clearAffectedRecords(batchId) {
    db.prepare('DELETE FROM suspension_affected_appointments WHERE batch_id = ?').run(batchId);
    return db.prepare('DELETE FROM suspension_affected_waitlist WHERE batch_id = ?').run(batchId);
  },

  updateAffectedAppointmentProcessed(id, newStatus, processResult, processNote) {
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE suspension_affected_appointments
      SET new_status = ?, processed = 1, process_result = ?, process_note = ?, processed_at = ?
      WHERE id = ?
    `).run(newStatus, processResult, processNote, now, id);
  },

  updateAffectedWaitlistProcessed(id, newStatus, processResult, processNote, targetSlotId = null) {
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE suspension_affected_waitlist
      SET new_status = ?, processed = 1, process_result = ?, process_note = ?, target_slot_id = ?, processed_at = ?
      WHERE id = ?
    `).run(newStatus, processResult, processNote, targetSlotId, now, id);
  },

  cancelAppointment(appointmentId) {
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?
    `).run(now, appointmentId);
  },

  releaseSlotCapacity(slotId) {
    return db.prepare(`
      UPDATE slots SET available_count = available_count + 1 WHERE id = ?
    `).run(slotId);
  },

  updateWaitlistStatus(waitlistId, status) {
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE waitlist SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, now, waitlistId);
  },

  findNextAvailableSlot(doctorId, afterDate) {
    return db.prepare(`
      SELECT s.* FROM slots s
      WHERE s.doctor_id = ? AND s.date > ? AND s.status = 'active' AND s.available_count > 0
      ORDER BY s.date, s.period
      LIMIT 1
    `).all(doctorId, afterDate);
  },

  addNotification(batchId, patientId, appointmentId, waitlistId, notificationType, content) {
    return db.prepare(`
      INSERT INTO suspension_notifications
      (batch_id, patient_id, appointment_id, waitlist_id, notification_type, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(batchId, patientId, appointmentId, waitlistId, notificationType, content);
  },

  getNotifications(batchId) {
    return db.prepare(`
      SELECT sn.*, p.name AS patient_name, p.phone
      FROM suspension_notifications sn
      JOIN patients p ON sn.patient_id = p.id
      WHERE sn.batch_id = ?
      ORDER BY sn.created_at
    `).all(batchId);
  },

  addExportRecord(batchId, exportType, filePath, fileName, recordCount, createdBy) {
    return db.prepare(`
      INSERT INTO suspension_exports
      (batch_id, export_type, file_path, file_name, record_count, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(batchId, exportType, filePath, fileName, recordCount, createdBy);
  },

  getExportRecords(batchId = null) {
    if (batchId) {
      return db.prepare('SELECT * FROM suspension_exports WHERE batch_id = ? ORDER BY created_at DESC').all(batchId);
    }
    return db.prepare('SELECT * FROM suspension_exports ORDER BY created_at DESC').all();
  },

  addRevocationRecord(batchId, reason, restoredAppointments, restoredWaitlist, restoredSlots, createdBy) {
    return db.prepare(`
      INSERT INTO suspension_revocations
      (batch_id, reason, restored_appointments, restored_waitlist, restored_slots, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(batchId, reason, restoredAppointments, restoredWaitlist, restoredSlots, createdBy);
  },

  getRevocationRecord(batchId) {
    return db.prepare('SELECT * FROM suspension_revocations WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1').get(batchId);
  },

  getConfig(key) {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setConfig(key, value, updatedBy) {
    const now = new Date().toISOString();
    return db.prepare(`
      INSERT INTO config (key, value, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `).run(key, value, now, updatedBy);
  },

  getAllConfig() {
    return db.prepare('SELECT key, value, updated_at, updated_by FROM config').all();
  },

  markNotificationSent(notificationId) {
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE suspension_notifications SET sent = 1, sent_at = ? WHERE id = ?
    `).run(now, notificationId);
  },

  getBatchSummary(batchId) {
    const apptCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM suspension_affected_appointments WHERE batch_id = ?
    `).get(batchId).cnt;
    const waitCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM suspension_affected_waitlist WHERE batch_id = ?
    `).get(batchId).cnt;
    const slotCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM suspension_affected_slots WHERE batch_id = ?
    `).get(batchId).cnt;
    return { appointmentCount: apptCount, waitlistCount: waitCount, slotCount };
  }
};

module.exports = dao;
