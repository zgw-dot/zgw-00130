const db = require('./db');
const { dao, generateBatchNo } = require('./precheckDao');
const { logAudit } = require('./audit');

function permError(msg) {
  const e = new Error(msg);
  e.statusCode = 403;
  return e;
}

function bizError(msg) {
  const e = new Error(msg);
  e.statusCode = 400;
  return e;
}

function validateReason(reason) {
  if (reason === undefined || reason === null) return false;
  const trimmed = String(reason).trim();
  return trimmed.length > 0;
}

function canUserPerform(user, action) {
  const role = user.role;
  const isAdmin = role === 'admin';

  switch (action) {
    case 'import':
      return isAdmin || dao.getConfig('precheck_clerk_can_import') === 'true';
    case 'freeze':
      return isAdmin || dao.getConfig('precheck_clerk_can_freeze') === 'true';
    case 'release':
      return isAdmin || dao.getConfig('precheck_clerk_can_release') === 'true';
    case 'force_release': {
      const requiredRole = dao.getConfig('precheck_force_release_role') || 'admin';
      if (requiredRole === 'admin') return isAdmin;
      if (requiredRole === 'clerk') return true;
      return isAdmin;
    }
    case 'revoke':
      return isAdmin || dao.getConfig('precheck_clerk_can_revoke') === 'true';
    case 'update_rules':
      return isAdmin;
    default:
      return isAdmin;
  }
}

function checkAllRequiredVerified(record) {
  const labRequired = dao.getConfig('precheck_lab_required') === 'true';
  const imagingRequired = dao.getConfig('precheck_imaging_required') === 'true';
  const consentRequired = dao.getConfig('precheck_consent_required') === 'true';
  const fastingRequired = dao.getConfig('precheck_fasting_required') === 'true';

  const missing = [];
  if (labRequired && !record.lab_result) missing.push('化验报告');
  if (imagingRequired && !record.imaging_result) missing.push('影像检查');
  if (consentRequired && !record.consent_result) missing.push('知情同意书');
  if (fastingRequired && !record.fasting_result) missing.push('禁食要求确认');

  return { ok: missing.length === 0, missing };
}

function generateNotificationContent(type, record, extra = {}) {
  const patientName = record.patient_name || '患者';
  const dateStr = record.slot_date || record.check_date;
  const doctorName = record.doctor_name || '';
  const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' };
  const period = periodMap[record.period] || record.period || '';

  switch (type) {
    case 'frozen':
      return `【术前核验冻结】${patientName}您好，您${dateStr}${period}${doctorName ? ' ' + doctorName + '医生' : ''}的手术预约因「${extra.reason || '材料不全'}」被暂时冻结，请尽快补齐材料。`;
    case 'released':
      return `【术前核验放行】${patientName}您好，您${dateStr}${period}${doctorName ? ' ' + doctorName + '医生' : ''}的手术预约材料已补齐，核验通过，请按时就诊。`;
    case 'force_released':
      return `【术前核验强制放行】${patientName}您好，您${dateStr}${period}${doctorName ? ' ' + doctorName + '医生' : ''}的手术预约已由管理员特批放行，请按时就诊。`;
    case 'revoked':
      return `【术前核验撤销】${patientName}您好，您${dateStr}${period}${doctorName ? ' ' + doctorName + '医生' : ''}的预约放行状态已被撤销，原因：${extra.reason || '操作回滚'}。`;
    case 'doctor_notify':
      return `【术前核验完成】${dateStr}${period} ${patientName}（${record.patient_phone || ''}）的术前核验已通过，请安排接诊。`;
    default:
      return '';
  }
}

const precheckService = {
  importByDate(req, date) {
    if (!date) throw bizError('请指定导入日期');
    if (!canUserPerform(req.user, 'import')) {
      throw permError('您没有导入术前核验数据的权限');
    }

    const batchNo = generateBatchNo();
    const appointments = dao.listAppointmentsForImport(date);
    if (appointments.length === 0) {
      return { imported: 0, skipped: 0, batchNo, message: '该日期没有待处理的预约' };
    }

    const results = { imported: 0, skipped: 0, conflicts: [], batchNo };

    const tx = db.transaction(() => {
      for (const appt of appointments) {
        if (appt.status === 'cancelled') {
          results.skipped++;
          continue;
        }

        const existing = dao.getByAppointmentId(appt.id);
        if (existing) {
          if (['cancelled', 'checked_in', 'frozen'].includes(existing.status)) {
            results.skipped++;
            continue;
          }
          results.skipped++;
          continue;
        }

        const dupCount = dao.checkDuplicateExecutable(appt.patient_id, appt.slot_id);
        if (dupCount > 0) {
          results.conflicts.push({
            patientName: appt.patient_name,
            appointmentId: appt.id,
            reason: '同一患者同一时段已存在可执行预约'
          });
          results.skipped++;
          continue;
        }

        dao.insertOrUpdateRecord({
          appointmentId: appt.id,
          patientId: appt.patient_id,
          slotId: appt.slot_id,
          checkDate: date,
          importBatch: batchNo,
          createdBy: req.user.id
        });
        results.imported++;
      }
    });

    tx();

    logAudit(req, {
      action: 'precheck_import',
      entityType: 'precheck',
      newValue: { date, batchNo, ...results },
      reason: `按日期 ${date} 导入术前核验待办，批次 ${batchNo}`
    });

    return results;
  },

  listRecords(req, options = {}) {
    return dao.listRecords(options);
  },

  getStats(req, date = null) {
    return dao.countRecordsByStatus(date);
  },

  getRecord(req, id) {
    const record = dao.getById(id);
    if (!record) throw new Error('核验记录不存在');
    return record;
  },

  updateCheckItems(req, id, items) {
    const record = dao.getById(id);
    if (!record) throw bizError('核验记录不存在');

    const nonEditable = ['cancelled', 'checked_in'];
    if (nonEditable.includes(record.status)) {
      throw bizError('当前状态不允许修改核验项');
    }

    dao.updateCheckItems(id, items, req.user.id);

    const updated = dao.getById(id);
    const { ok, missing } = checkAllRequiredVerified(updated);

    if (ok && updated.status === 'pending') {
      dao.setVerified(id, req.user.id);
    }

    logAudit(req, {
      action: 'precheck_update_items',
      entityType: 'precheck',
      entityId: id,
      patientId: record.patient_id,
      oldValue: {
        lab: record.lab_result, imaging: record.imaging_result,
        consent: record.consent_result, fasting: record.fasting_result
      },
      newValue: {
        lab: items.labResult, imaging: items.imagingResult,
        consent: items.consentResult, fasting: items.fastingResult,
        verified: ok
      },
      reason: ok ? '核验项已全部完成' : `更新核验项（缺少：${missing.join('、') || '无'}）`
    });

    return { ok, missing, record: dao.getById(id) };
  },

  freezeRecord(req, id, reason) {
    if (!validateReason(reason)) {
      throw bizError('冻结必须提供原因');
    }
    if (!canUserPerform(req.user, 'freeze')) {
      throw permError('您没有冻结预约的权限');
    }

    const record = dao.getById(id);
    if (!record) throw bizError('核验记录不存在');
    if (!['pending', 'verified'].includes(record.status)) {
      throw bizError(`当前状态(${record.status})不允许冻结`);
    }

    const trimmedReason = String(reason).trim();
    const result = dao.freezeRecord(id, trimmedReason, req.user.id);
    if (result.changes === 0) throw bizError('冻结失败');

    const updated = dao.getById(id);

    const content = generateNotificationContent('frozen', updated, { reason: trimmedReason });
    dao.addNotification({
      precheckId: id,
      patientId: record.patient_id,
      appointmentId: record.appointment_id,
      notificationType: 'frozen',
      recipientRole: 'patient',
      content,
      sentBy: req.user.id
    });

    logAudit(req, {
      action: 'precheck_freeze',
      entityType: 'precheck',
      entityId: id,
      patientId: record.patient_id,
      oldValue: { status: record.status },
      newValue: { status: 'frozen', freeze_reason: trimmedReason },
      reason: trimmedReason
    });

    return { record: updated, notification: content };
  },

  releaseRecord(req, id, releaseNote, force = false) {
    const action = force ? 'force_release' : 'release';
    if (!canUserPerform(req.user, action)) {
      throw permError(force ? '您没有强制放行的权限，仅管理员可操作' : '您没有放行的权限');
    }

    const record = dao.getById(id);
    if (!record) throw bizError('核验记录不存在');
    if (record.status !== 'frozen') {
      throw bizError(`当前状态(${record.status})不允许放行`);
    }

    if (!force) {
      const { ok, missing } = checkAllRequiredVerified(record);
      if (!ok) {
        throw bizError(`核验项未全部完成，缺少：${missing.join('、')}。若需强制放行请使用管理员权限`);
      }
    }

    const trimmedNote = validateReason(releaseNote) ? String(releaseNote).trim() : (force ? '强制放行' : null);

    const result = dao.releaseRecord(id, trimmedNote, req.user.id, force);
    if (result.changes === 0) throw bizError('放行失败');

    const updated = dao.getById(id);
    const notifType = force ? 'force_released' : 'released';
    const content = generateNotificationContent(notifType, updated, {});
    dao.addNotification({
      precheckId: id,
      patientId: record.patient_id,
      appointmentId: record.appointment_id,
      notificationType: notifType,
      recipientRole: 'patient',
      content,
      sentBy: req.user.id
    });

    if (dao.getConfig('precheck_auto_notify_doctor_on_release') === 'true') {
      const doctorContent = generateNotificationContent('doctor_notify', updated, {});
      dao.addNotification({
        precheckId: id,
        patientId: record.patient_id,
        appointmentId: record.appointment_id,
        notificationType: 'doctor_notify',
        recipientRole: 'doctor',
        content: doctorContent,
        sentBy: req.user.id
      });
    }

    logAudit(req, {
      action: force ? 'precheck_force_release' : 'precheck_release',
      entityType: 'precheck',
      entityId: id,
      patientId: record.patient_id,
      oldValue: { status: record.status, freeze_reason: record.freeze_reason },
      newValue: { status: force ? 'force_released' : 'released', release_note: trimmedNote },
      reason: force ? '强制放行（特批）' : (trimmedNote || '核验通过放行')
    });

    return { record: updated, patientNotification: content };
  },

  revokeRecord(req, id, reason) {
    if (!validateReason(reason)) {
      throw bizError('撤销必须提供原因');
    }
    if (!canUserPerform(req.user, 'revoke')) {
      throw permError('您没有撤销放行的权限');
    }

    const record = dao.getById(id);
    if (!record) throw bizError('核验记录不存在');
    if (!['released', 'force_released'].includes(record.status)) {
      throw bizError(`当前状态(${record.status})不允许撤销`);
    }

    const trimmedReason = String(reason).trim();
    const result = dao.revokeRecord(id, trimmedReason, req.user.id);
    if (result.changes === 0) throw bizError('撤销失败');

    const updated = dao.getById(id);

    const content = generateNotificationContent('revoked', updated, { reason: trimmedReason });
    dao.addNotification({
      precheckId: id,
      patientId: record.patient_id,
      appointmentId: record.appointment_id,
      notificationType: 'revoked',
      recipientRole: 'patient',
      content,
      sentBy: req.user.id
    });

    logAudit(req, {
      action: 'precheck_revoke',
      entityType: 'precheck',
      entityId: id,
      patientId: record.patient_id,
      oldValue: { status: record.status, release_note: record.release_note },
      newValue: { status: 'revoked', revoke_reason: trimmedReason },
      reason: trimmedReason
    });

    return { record: updated, notification: content };
  },

  getConfig(req) {
    return dao.getAllConfig();
  },

  updateConfig(req, key, value) {
    if (!canUserPerform(req.user, 'update_rules')) {
      throw permError('仅管理员可修改术前核验规则');
    }

    const allowedKeys = [
      'precheck_lab_required', 'precheck_imaging_required',
      'precheck_consent_required', 'precheck_fasting_required',
      'precheck_force_release_role', 'precheck_auto_notify_doctor_on_release',
      'precheck_clerk_can_import', 'precheck_clerk_can_freeze',
      'precheck_clerk_can_release', 'precheck_clerk_can_revoke'
    ];
    if (!allowedKeys.includes(key)) {
      throw bizError('不支持的配置键');
    }

    const oldVal = dao.getConfig(key);
    dao.setConfig(key, value, req.user.id);

    logAudit(req, {
      action: 'precheck_config_update',
      entityType: 'precheck_config',
      oldValue: { [key]: oldVal },
      newValue: { [key]: value },
      reason: `修改术前核验规则 ${key}`
    });

    return {
      message: `已更新 ${key} = ${value}`,
      key,
      old: oldVal,
      new: value
    };
  },

  checkPermissions(req) {
    return {
      canImport: canUserPerform(req.user, 'import'),
      canFreeze: canUserPerform(req.user, 'freeze'),
      canRelease: canUserPerform(req.user, 'release'),
      canForceRelease: canUserPerform(req.user, 'force_release'),
      canRevoke: canUserPerform(req.user, 'revoke'),
      canUpdateRules: canUserPerform(req.user, 'update_rules')
    };
  },

  listNotifications(req, precheckId = null) {
    return dao.listNotifications(precheckId);
  },

  listExports(req) {
    return dao.listExports();
  },

  getAppointmentForImportPreview(req, date) {
    return dao.listAppointmentsForImport(date);
  },

  verifyDuplicateConflict(req, patientId, slotId, excludeId = null) {
    const count = dao.checkDuplicateExecutable(patientId, slotId, excludeId);
    return { hasConflict: count > 0, count };
  }
};

module.exports = precheckService;
