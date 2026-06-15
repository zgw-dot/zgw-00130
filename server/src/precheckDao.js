const db = require('./db');
const crypto = require('crypto');

function generateBatchNo() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PRE${dateStr}${random}`;
}

function md5Hash(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

const dao = {
  insertOrUpdateRecord(params) {
    const {
      appointmentId, patientId, slotId, checkDate,
      importBatch = null, createdBy = null
    } = params;
    const existing = db.prepare('SELECT id FROM precheck_records WHERE appointment_id = ?').get(appointmentId);
    if (existing) {
      return existing.id;
    }
    const stmt = db.prepare(`
      INSERT INTO precheck_records
      (appointment_id, patient_id, slot_id, check_date, import_batch, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    const result = stmt.run(appointmentId, patientId, slotId, checkDate, importBatch, createdBy);
    return result.lastInsertRowid;
  },

  getById(id) {
    return db.prepare(`
      SELECT p.*, pt.name AS patient_name, pt.phone AS patient_phone, pt.id_card,
        s.date AS slot_date, s.period, s.time_start, s.time_end,
        d.name AS doctor_name, d.department,
        a.status AS appointment_status,
        cu.username AS created_by_name,
        uu.username AS updated_by_name,
        fu.username AS frozen_by_name,
        ru.username AS released_by_name,
        vu.username AS revoked_by_name
      FROM precheck_records p
      JOIN patients pt ON p.patient_id = pt.id
      JOIN slots s ON p.slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      JOIN appointments a ON p.appointment_id = a.id
      LEFT JOIN users cu ON p.created_by = cu.id
      LEFT JOIN users uu ON p.updated_by = uu.id
      LEFT JOIN users fu ON p.frozen_by = fu.id
      LEFT JOIN users ru ON p.released_by = ru.id
      LEFT JOIN users vu ON p.revoked_by = vu.id
      WHERE p.id = ?
    `).get(id);
  },

  getByAppointmentId(appointmentId) {
    return db.prepare('SELECT * FROM precheck_records WHERE appointment_id = ?').get(appointmentId);
  },

  listRecords(options = {}) {
    const {
      date = null,
      status = null,
      statuses = null,
      patientId = null,
      doctorId = null,
      offset = 0,
      limit = 500
    } = options;

    let sql = `
      SELECT p.*, pt.name AS patient_name, pt.phone AS patient_phone, pt.id_card,
        s.date AS slot_date, s.period, s.time_start, s.time_end,
        d.name AS doctor_name, d.department,
        a.status AS appointment_status
      FROM precheck_records p
      JOIN patients pt ON p.patient_id = pt.id
      JOIN slots s ON p.slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      JOIN appointments a ON p.appointment_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (date) { sql += ' AND p.check_date = ?'; params.push(date); }
    if (status) { sql += ' AND p.status = ?'; params.push(status); }
    if (statuses && statuses.length) {
      sql += ` AND p.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
    if (patientId) { sql += ' AND p.patient_id = ?'; params.push(patientId); }
    if (doctorId) { sql += ' AND s.doctor_id = ?'; params.push(doctorId); }

    sql += ' ORDER BY p.check_date, s.period, pt.name ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(sql).all(...params);
  },

  listAppointmentsForImport(date) {
    return db.prepare(`
      SELECT a.*, p.id AS patient_id, p.name AS patient_name, p.phone, p.id_card,
        s.id AS slot_id, s.date, s.period, s.time_start, s.time_end,
        d.id AS doctor_id, d.name AS doctor_name, d.department
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN slots s ON a.slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      WHERE s.date = ?
        AND a.status IN ('booked', 'confirmed')
      ORDER BY s.period, p.name
    `).all(date);
  },

  updateCheckItems(id, items, updatedBy) {
    const now = new Date().toISOString();
    const {
      labResult, labNote,
      imagingResult, imagingNote,
      consentResult, consentNote,
      fastingResult, fastingNote,
      customResult
    } = items;
    return db.prepare(`
      UPDATE precheck_records SET
        lab_result = ?, lab_note = ?,
        imaging_result = ?, imaging_note = ?,
        consent_result = ?, consent_note = ?,
        fasting_result = ?, fasting_note = ?,
        custom_result = ?,
        updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      labResult ? 1 : 0, labNote || null,
      imagingResult ? 1 : 0, imagingNote || null,
      consentResult ? 1 : 0, consentNote || null,
      fastingResult ? 1 : 0, fastingNote || null,
      customResult || null,
      updatedBy, now, id
    );
  },

  freezeRecord(id, reason, frozenBy) {
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE precheck_records SET
        status = 'frozen', freeze_reason = ?,
        frozen_by = ?, frozen_at = ?,
        updated_by = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'verified')
    `).run(reason, frozenBy, now, frozenBy, now, id);
  },

  releaseRecord(id, releaseNote, releasedBy, force = false) {
    const now = new Date().toISOString();
    const newStatus = force ? 'force_released' : 'released';
    return db.prepare(`
      UPDATE precheck_records SET
        status = ?, release_note = ?,
        released_by = ?, released_at = ?,
        updated_by = ?, updated_at = ?
      WHERE id = ? AND status = 'frozen'
    `).run(newStatus, releaseNote || null, releasedBy, now, releasedBy, now, id);
  },

  revokeRecord(id, reason, revokedBy) {
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE precheck_records SET
        status = 'revoked', revoke_reason = ?,
        revoked_by = ?, revoked_at = ?,
        updated_by = ?, updated_at = ?
      WHERE id = ? AND status IN ('released', 'force_released')
    `).run(reason, revokedBy, now, revokedBy, now, id);
  },

  setVerified(id, updatedBy) {
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE precheck_records SET
        status = 'verified',
        updated_by = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(updatedBy, now, id);
  },

  checkDuplicateByHalfDay(patientId, date, period, excludeId = null) {
    let sql = `
      SELECT COUNT(*) AS cnt FROM precheck_records p
      JOIN slots s ON p.slot_id = s.id
      WHERE p.patient_id = ?
        AND s.date = ?
        AND s.period = ?
        AND p.status IN ('pending', 'verified', 'frozen', 'released', 'force_released')
    `;
    const params = [patientId, date, period];
    if (excludeId) {
      sql += ' AND p.id != ?';
      params.push(excludeId);
    }
    return db.prepare(sql).get(...params).cnt;
  },

  checkDuplicateExecutable(patientId, slotId, excludeId = null) {
    const slot = db.prepare('SELECT date, period FROM slots WHERE id = ?').get(slotId);
    if (!slot) return 0;
    return dao.checkDuplicateByHalfDay(patientId, slot.date, slot.period, excludeId);
  },

  listConflictingRecords(patientId, date, period, excludeId = null) {
    let sql = `
      SELECT p.*, s.date AS slot_date, s.period, s.time_start, s.time_end,
        d.name AS doctor_name, d.department
      FROM precheck_records p
      JOIN slots s ON p.slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      WHERE p.patient_id = ?
        AND s.date = ?
        AND s.period = ?
        AND p.status IN ('pending', 'verified', 'frozen', 'released', 'force_released')
    `;
    const params = [patientId, date, period];
    if (excludeId) {
      sql += ' AND p.id != ?';
      params.push(excludeId);
    }
    sql += ' ORDER BY p.created_at ASC';
    return db.prepare(sql).all(...params);
  },

  addNotification(params) {
    const {
      precheckId, patientId, appointmentId,
      notificationType, recipientRole, content, sentBy
    } = params;
    return db.prepare(`
      INSERT INTO precheck_notifications
      (precheck_id, patient_id, appointment_id,
       notification_type, recipient_role, content, sent_by, sent, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).run(precheckId, patientId, appointmentId || null,
           notificationType, recipientRole, content, sentBy || null);
  },

  listNotifications(precheckId = null) {
    let sql = `
      SELECT n.*, p.name AS patient_name, p.phone
      FROM precheck_notifications n
      JOIN patients p ON n.patient_id = p.id
    `;
    const params = [];
    if (precheckId) {
      sql += ' WHERE n.precheck_id = ?';
      params.push(precheckId);
    }
    sql += ' ORDER BY n.created_at DESC';
    return db.prepare(sql).all(...params);
  },

  addExportRecord(params) {
    const { exportType, fileName, filePath, dateFilter = null, recordCount, snapshotHash, createdBy } = params;
    return db.prepare(`
      INSERT INTO precheck_exports
      (export_type, file_name, file_path, date_filter, record_count, snapshot_hash, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(exportType, fileName, filePath, dateFilter, recordCount, snapshotHash || null, createdBy);
  },

  listExports() {
    return db.prepare(`
      SELECT e.*, u.username AS created_by_name
      FROM precheck_exports e
      LEFT JOIN users u ON e.created_by = u.id
      ORDER BY e.created_at DESC
      LIMIT 100
    `).all();
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
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(key, String(value), now, updatedBy);
  },

  getAllConfig() {
    return db.prepare(`
      SELECT key, value, updated_at, u.username AS updated_by_name
      FROM config c
      LEFT JOIN users u ON c.updated_by = u.id
      WHERE c.key LIKE 'precheck_%'
      ORDER BY c.key
    `).all();
  },

  getAppointmentById(appointmentId) {
    return db.prepare(`
      SELECT a.*, p.name AS patient_name, p.phone, p.id_card, p.id AS patient_id,
        s.date, s.period, s.time_start, s.time_end, s.id AS slot_id,
        d.name AS doctor_name, d.department, d.id AS doctor_id
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN slots s ON a.slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      WHERE a.id = ?
    `).get(appointmentId);
  },

  countRecordsByStatus(date = null) {
    let sql = `
      SELECT p.status, COUNT(*) AS cnt
      FROM precheck_records p
      JOIN slots s ON p.slot_id = s.id
    `;
    const params = [];
    if (date) {
      sql += ' WHERE p.check_date = ?';
      params.push(date);
    }
    sql += ' GROUP BY p.status';
    const rows = db.prepare(sql).all(...params);
    const result = {};
    rows.forEach(r => { result[r.status] = r.cnt; });
    return result;
  },

  generateSnapshotHash(records) {
    const data = records.map(r => JSON.stringify({
      id: r.id,
      status: r.status,
      patient_name: r.patient_name,
      lab: r.lab_result,
      imaging: r.imaging_result,
      consent: r.consent_result,
      fasting: r.fasting_result,
      freeze_reason: r.freeze_reason
    })).join('|');
    return md5Hash(data);
  }
};

module.exports = { dao, generateBatchNo };
