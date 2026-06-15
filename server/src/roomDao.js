const db = require('./db');

const roomDao = {
  create(name, location) {
    const stmt = db.prepare(`
      INSERT INTO rooms (name, location, status)
      VALUES (?, ?, 'active')
    `);
    const result = stmt.run(name, location || null);
    return roomDao.getById(result.lastInsertRowid);
  },

  getById(id) {
    return db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  },

  getByName(name) {
    return db.prepare('SELECT * FROM rooms WHERE name = ?').get(name);
  },

  list(status = null) {
    if (status) {
      return db.prepare('SELECT * FROM rooms WHERE status = ? ORDER BY id').all(status);
    }
    return db.prepare('SELECT * FROM rooms ORDER BY id').all();
  },

  update(id, { name, location, status }) {
    const existing = roomDao.getById(id);
    if (!existing) return null;
    const newName = name !== undefined ? name : existing.name;
    const newLocation = location !== undefined ? location : existing.location;
    const newStatus = status !== undefined ? status : existing.status;
    db.prepare(`
      UPDATE rooms SET name = ?, location = ?, status = ? WHERE id = ?
    `).run(newName, newLocation, newStatus, id);
    return roomDao.getById(id);
  },

  remove(id) {
    return db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  },

  countActive() {
    return db.prepare("SELECT COUNT(*) as cnt FROM rooms WHERE status = 'active'").get().cnt;
  },

  getCalendarSlots(startDate, endDate, roomId = null, doctorId = null) {
    let sql = `
      SELECT s.*, d.name AS doctor_name, d.department, r.name AS room_name, r.location AS room_location
      FROM slots s
      JOIN doctors d ON s.doctor_id = d.id
      LEFT JOIN rooms r ON s.room_id = r.id
      WHERE s.date >= ? AND s.date <= ?
    `;
    const params = [startDate, endDate];
    if (roomId) {
      sql += ' AND s.room_id = ?';
      params.push(roomId);
    }
    if (doctorId) {
      sql += ' AND s.doctor_id = ?';
      params.push(doctorId);
    }
    sql += ' ORDER BY s.date, s.period, s.doctor_id';
    return db.prepare(sql).all(...params);
  },

  getAppointmentsBySlotIds(slotIds) {
    if (!slotIds || slotIds.length === 0) return [];
    const placeholders = slotIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT a.*, p.name AS patient_name, p.phone, p.id_card
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE a.slot_id IN (${placeholders})
      AND a.status IN ('booked', 'confirmed')
      ORDER BY a.slot_id, a.created_at
    `).all(...slotIds);
  },

  getWaitlistBySlotIds(slotIds) {
    if (!slotIds || slotIds.length === 0) return [];
    const placeholders = slotIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT w.*, p.name AS patient_name, p.phone, p.id_card
      FROM waitlist w
      JOIN patients p ON w.patient_id = p.id
      WHERE w.slot_id IN (${placeholders})
      AND w.status IN ('waiting', 'notifying')
      ORDER BY w.slot_id, w.position
    `).all(...slotIds);
  },

  getActiveRoomLocks(startDate, endDate, roomId = null) {
    let sql = `
      SELECT si.id as item_id, si.item_type, si.item_value, si.description,
             sb.id as batch_id, sb.batch_no, sb.title, sb.reason, sb.status,
             sb.created_at, sb.executed_at, sas.slot_id
      FROM suspension_items si
      JOIN suspension_batches sb ON si.batch_id = sb.id
      LEFT JOIN suspension_affected_slots sas ON sb.id = sas.batch_id
      WHERE si.item_type = 'room'
      AND sb.status IN ('pending', 'executing', 'completed')
    `;
    const params = [];
    if (roomId) {
      sql += ' AND si.item_value = ?';
      params.push(String(roomId));
    }
    sql += ' ORDER BY sb.created_at DESC';
    return db.prepare(sql).all(...params);
  },

  checkRoomTimeConflict(roomId, slotIds, excludeBatchId = null) {
    if (!slotIds || slotIds.length === 0) return [];
    const placeholders = slotIds.map(() => '?').join(',');
    let sql = `
      SELECT DISTINCT sas.slot_id, sb.batch_no, sb.title, sb.status
      FROM suspension_affected_slots sas
      JOIN suspension_batches sb ON sas.batch_id = sb.id
      JOIN slots s ON sas.slot_id = s.id
      WHERE s.room_id = ?
      AND sas.slot_id IN (${placeholders})
      AND sb.status IN ('pending', 'executing', 'completed')
    `;
    const params = [roomId, ...slotIds];
    if (excludeBatchId) {
      sql += ' AND sb.id != ?';
      params.push(excludeBatchId);
    }
    return db.prepare(sql).all(...params);
  }
};

module.exports = roomDao;
