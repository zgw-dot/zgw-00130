const db = require('./db');
const { getClientIp } = require('./middleware');

const logAudit = (req, { action, entityType, entityId, slotId, waitlistId, patientId, oldValue, newValue, reason }) => {
  const stmt = db.prepare(`
    INSERT INTO audit_logs 
    (user_id, action, entity_type, entity_id, slot_id, waitlist_id, patient_id, old_value, new_value, reason, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    req?.user?.id ?? null,
    action,
    entityType,
    entityId ?? null,
    slotId ?? null,
    waitlistId ?? null,
    patientId ?? null,
    oldValue != null ? JSON.stringify(oldValue) : null,
    newValue != null ? JSON.stringify(newValue) : null,
    reason ?? null,
    req ? getClientIp(req) : 'system'
  );
};

module.exports = { logAudit };
