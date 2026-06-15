const db = require('./db');
const dao = require('./suspensionDao');
const roomDao = require('./roomDao');
const { logAudit } = require('./audit');

function generateAppointmentNotification(appt, batch, reason) {
  return `【停诊通知】尊敬的${appt.patient_name}您好，您预约的${appt.date} ${appt.period} ${appt.doctor_name}医生的就诊因${reason || '医院安排调整'}已取消。批次号：${batch.batch_no}。请您及时改约，给您带来不便敬请谅解。`;
}

function generateWaitlistNotification(wait, batch, reason, strategy) {
  if (strategy === 'auto_postpone') {
    return `【停诊通知】尊敬的${wait.patient_name}您好，您候补的${wait.date} ${wait.period} ${wait.doctor_name}医生的号源因${reason || '医院安排调整'}已暂停。批次号：${batch.batch_no}。系统将自动为您顺延至下一可用号源，如有疑问请联系医院。`;
  }
  return `【停诊通知】尊敬的${wait.patient_name}您好，您候补的${wait.date} ${wait.period} ${wait.doctor_name}医生的号源因${reason || '医院安排调整'}已暂停。批次号：${batch.batch_no}。请您联系医院确认后续安排，给您带来不便敬请谅解。`;
}

function generateManualReviewNotification(wait, batch, reason) {
  return `【人工处理通知】尊敬的${wait.patient_name}您好，您候补的${wait.date} ${wait.period} ${wait.doctor_name}医生的号源因${reason || '医院安排调整'}需要人工确认处理。批次号：${batch.batch_no}。医院工作人员将尽快与您联系。`;
}

const suspensionService = {
  createDraftBatch(req, title, reason, remarks) {
    const batch = dao.createBatch(title, reason, req.user.id, remarks);
    logAudit(req, {
      action: 'suspension_batch_created',
      entityType: 'suspension_batch',
      entityId: batch.id,
      reason: `创建停诊批次草稿: ${title}`
    });
    return batch;
  },

  addBatchItems(req, batchId, items) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');
    if (!['draft', 'pending'].includes(batch.status)) {
      throw new Error('只能在草稿或待确认状态下添加条目');
    }

    dao.clearItems(batchId);
    items.forEach(item => {
      dao.addItem(batchId, item.type, item.value, item.description);
    });

    logAudit(req, {
      action: 'suspension_items_updated',
      entityType: 'suspension_batch',
      entityId: batchId,
      newValue: items,
      reason: '更新停诊批次条目'
    });

    return dao.getItemsByBatch(batchId);
  },

  previewAffected(batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');

    const items = dao.getItemsByBatch(batchId);
    const allSlots = [];
    const seenSlotIds = new Set();

    for (const item of items) {
      let slots;
      if (item.item_type === 'date') {
        slots = dao.findSlotsByCriteria(item.item_value, null, null);
      } else if (item.item_type === 'doctor') {
        slots = dao.findSlotsByCriteria(null, parseInt(item.item_value), null);
      } else if (item.item_type === 'room') {
        const roomId = parseInt(item.item_value, 10);
        if (isNaN(roomId) || !roomDao.getById(roomId)) {
          throw new Error(`诊室不存在: ${item.item_value}`);
        }
        slots = dao.findSlotsByCriteria(null, null, item.item_value);
      }

      for (const slot of slots) {
        if (!seenSlotIds.has(slot.id)) {
          seenSlotIds.add(slot.id);
          allSlots.push(slot);
        }
      }
    }

    const slotIds = allSlots.map(s => s.id);
    const conflicts = slotIds.length > 0 ? dao.checkSlotConflict(slotIds, batchId) : [];
    const appointments = slotIds.length > 0 ? dao.getConfirmedAppointments(slotIds) : [];
    const waitlist = slotIds.length > 0 ? dao.getActiveWaitlist(slotIds) : [];

    return {
      slots: allSlots,
      appointments,
      waitlist,
      conflicts,
      totals: {
        slotCount: allSlots.length,
        appointmentCount: appointments.length,
        waitlistCount: waitlist.length,
        conflictCount: conflicts.length
      }
    };
  },

  saveDraft(req, batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');
    if (batch.status !== 'draft') throw new Error('只能保存草稿状态的批次');

    const preview = this.previewAffected(batchId);
    if (preview.conflicts.length > 0) {
      const conflictSlots = preview.conflicts.map(c => `号源${c.slot_id}(批次${c.batch_no})`).join(', ');
      throw new Error(`存在号源冲突：${conflictSlots}`);
    }

    const tx = db.transaction(() => {
      dao.clearAffectedSlots(batchId);
      dao.clearAffectedRecords(batchId);

      for (const slot of preview.slots) {
        dao.addAffectedSlot(batchId, slot.id);
      }

      for (const appt of preview.appointments) {
        const content = generateAppointmentNotification(appt, batch, batch.reason);
        dao.addAffectedAppointment(batchId, appt.slot_id, appt.id, appt.patient_id, appt.status, content);
        dao.addNotification(batchId, appt.patient_id, appt.id, null, 'appointment_cancelled', content);
      }

      for (const wait of preview.waitlist) {
        const strategy = dao.getConfig('suspension_waitlist_strategy');
        const content = generateWaitlistNotification(wait, batch, batch.reason, strategy);
        dao.addAffectedWaitlist(batchId, wait.slot_id, wait.id, wait.patient_id, wait.status, content);
        const notifType = strategy === 'auto_postpone' ? 'auto_postponed' : 'manual_review_required';
        dao.addNotification(batchId, wait.patient_id, null, wait.id, notifType, content);
      }

      dao.updateBatchStatus(batchId, 'pending', req.user.id);
    });

    tx();

    logAudit(req, {
      action: 'suspension_draft_saved',
      entityType: 'suspension_batch',
      entityId: batchId,
      newValue: preview.totals,
      reason: '保存停诊草稿并锁定号源'
    });

    return {
      batch: dao.getBatchById(batchId),
      ...preview.totals
    };
  },

  executeBatch(req, batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');
    if (req.user.role !== 'admin') {
      throw new Error('只有管理员可以提交正式批次');
    }
    if (batch.status !== 'pending') {
      throw new Error('只能执行待确认状态的批次');
    }

    const strategy = dao.getConfig('suspension_waitlist_strategy');
    const affectedAppointments = dao.getAffectedAppointments(batchId);
    const affectedWaitlist = dao.getAffectedWaitlist(batchId);
    const affectedSlots = dao.getAffectedSlots(batchId);

    const results = {
      appointments: { success: 0, failed: 0, skipped: 0 },
      waitlist: { success: 0, failed: 0, skipped: 0 },
      notifications: []
    };

    const tx = db.transaction(() => {
      dao.updateBatchStatus(batchId, 'executing', req.user.id);

      for (const appt of affectedAppointments) {
        try {
          if (appt.processed) {
            results.appointments.skipped++;
            continue;
          }

          dao.cancelAppointment(appt.appointment_id);
          dao.releaseSlotCapacity(appt.slot_id);
          dao.updateAffectedAppointmentProcessed(appt.id, 'cancelled', 'success', '已取消并释放号源');
          results.appointments.success++;

          const autoNotify = dao.getConfig('suspension_auto_notify');
          if (autoNotify === 'true') {
            results.notifications.push({
              type: 'appointment_cancelled',
              patientName: appt.patient_name,
              phone: appt.phone,
              content: appt.notification_content
            });
          }
        } catch (e) {
          results.appointments.failed++;
          dao.updateAffectedAppointmentProcessed(appt.id, appt.old_status, 'failed', e.message);
        }
      }

      for (const wait of affectedWaitlist) {
        try {
          if (wait.processed) {
            results.waitlist.skipped++;
            continue;
          }

          if (strategy === 'auto_postpone') {
            const slot = affectedSlots.find(s => s.slot_id === wait.slot_id);
            if (slot) {
              const nextSlots = dao.findNextAvailableSlot(slot.doctor_id, slot.date);
              if (nextSlots.length > 0) {
                const targetSlot = nextSlots[0];
                dao.updateWaitlistStatus(wait.waitlist_id, 'waiting');
                dao.updateAffectedWaitlistProcessed(
                  wait.id, 'waiting', 'success',
                  `已自动顺延至 ${targetSlot.date} ${targetSlot.period}`,
                  targetSlot.id
                );
                results.waitlist.success++;
              } else {
                dao.updateWaitlistStatus(wait.waitlist_id, 'cancelled');
                dao.updateAffectedWaitlistProcessed(wait.id, 'cancelled', 'warning', '无后续可用号源，已取消候补');
                results.waitlist.success++;
              }
            }
          } else {
            dao.updateAffectedWaitlistProcessed(wait.id, wait.old_status, 'pending_manual', '需人工确认处理');
            results.waitlist.success++;
          }

          const autoNotify = dao.getConfig('suspension_auto_notify');
          if (autoNotify === 'true') {
            results.notifications.push({
              type: strategy === 'auto_postpone' ? 'auto_postponed' : 'manual_review_required',
              patientName: wait.patient_name,
              phone: wait.phone,
              content: wait.notification_content
            });
          }
        } catch (e) {
          results.waitlist.failed++;
          dao.updateAffectedWaitlistProcessed(wait.id, wait.old_status, 'failed', e.message);
        }
      }

      dao.updateBatchStatus(batchId, 'completed', req.user.id);
    });

    tx();

    logAudit(req, {
      action: 'suspension_batch_executed',
      entityType: 'suspension_batch',
      entityId: batchId,
      newValue: results,
      reason: `正式执行停诊批次，策略: ${strategy}`
    });

    return {
      batch: dao.getBatchById(batchId),
      results,
      strategy
    };
  },

  revokeBatch(req, batchId, reason) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');
    if (req.user.role !== 'admin') {
      throw new Error('只有管理员可以撤销批次');
    }
    if (!['draft', 'pending', 'executing'].includes(batch.status)) {
      throw new Error('只能撤销未完成状态的批次');
    }

    const affectedAppointments = dao.getAffectedAppointments(batchId);
    const affectedWaitlist = dao.getAffectedWaitlist(batchId);
    const affectedSlots = dao.getAffectedSlots(batchId);

    const restoreStats = {
      restoredAppointments: 0,
      restoredWaitlist: 0,
      restoredSlots: 0
    };

    const tx = db.transaction(() => {
      for (const appt of affectedAppointments) {
        if (appt.processed && appt.new_status === 'cancelled') {
          db.prepare(`
            UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?
          `).run(appt.old_status, new Date().toISOString(), appt.appointment_id);
          db.prepare(`
            UPDATE slots SET available_count = available_count - 1 WHERE id = ?
          `).run(appt.slot_id);
          restoreStats.restoredAppointments++;
        }
      }

      for (const wait of affectedWaitlist) {
        if (wait.processed && wait.new_status !== wait.old_status) {
          db.prepare(`
            UPDATE waitlist SET status = ?, updated_at = ? WHERE id = ?
          `).run(wait.old_status, new Date().toISOString(), wait.waitlist_id);
          restoreStats.restoredWaitlist++;
        }
      }

      dao.clearAffectedSlots(batchId);
      restoreStats.restoredSlots = affectedSlots.length;

      dao.updateBatchStatus(batchId, 'revoked', req.user.id);
      dao.addRevocationRecord(
        batchId, reason,
        restoreStats.restoredAppointments,
        restoreStats.restoredWaitlist,
        restoreStats.restoredSlots,
        req.user.id
      );
    });

    tx();

    logAudit(req, {
      action: 'suspension_batch_revoked',
      entityType: 'suspension_batch',
      entityId: batchId,
      oldValue: batch.status,
      newValue: 'revoked',
      reason: reason || '撤销停诊批次'
    });

    return {
      batch: dao.getBatchById(batchId),
      restoreStats,
      revocationRecord: dao.getRevocationRecord(batchId)
    };
  },

  getBatchDetail(batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) return null;

    return {
      batch,
      items: dao.getItemsByBatch(batchId),
      affectedSlots: dao.getAffectedSlots(batchId),
      affectedAppointments: dao.getAffectedAppointments(batchId),
      affectedWaitlist: dao.getAffectedWaitlist(batchId),
      notifications: dao.getNotifications(batchId),
      exports: dao.getExportRecords(batchId),
      revocation: dao.getRevocationRecord(batchId),
      summary: dao.getBatchSummary(batchId)
    };
  },

  updateConfig(req, key, value) {
    if (req.user.role !== 'admin') {
      throw new Error('只有管理员可以修改全局配置');
    }

    const oldValue = dao.getConfig(key);
    dao.setConfig(key, value, req.user.id);

    logAudit(req, {
      action: 'suspension_config_updated',
      entityType: 'config',
      oldValue,
      newValue: value,
      reason: `修改停诊配置: ${key}`
    });

    return { key, oldValue, newValue: value };
  },

  getSuspensionConfig() {
    return {
      waitlistStrategy: dao.getConfig('suspension_waitlist_strategy') || 'auto_postpone',
      autoNotify: dao.getConfig('suspension_auto_notify') || 'true'
    };
  }
};

module.exports = suspensionService;
