const db = require('./db');
const dao = require('./rescheduleDao');
const { logAudit } = require('./audit');

function generateSuccessNotification(patientName, sourceDate, sourcePeriod, sourceDoctor, targetDate, targetPeriod, targetDoctor, batchNo) {
  return `【改期成功通知】尊敬的${patientName}您好，您的预约已成功改期。原预约：${sourceDate} ${sourcePeriod} ${sourceDoctor}医生；新预约：${targetDate} ${targetPeriod} ${targetDoctor}医生。改期批次号：${batchNo}。如有疑问请联系医院。`;
}

function generateWaitlistNotification(patientName, sourceDate, sourcePeriod, sourceDoctor, targetDate, targetPeriod, targetDoctor, batchNo) {
  return `【改期候补通知】尊敬的${patientName}您好，目标号源已满，已为您自动加入${targetDate} ${targetPeriod} ${targetDoctor}医生的候补队列。原预约：${sourceDate} ${sourcePeriod} ${sourceDoctor}医生。改期批次号：${batchNo}。有号时会及时通知您。`;
}

function generateFailedNotification(patientName, sourceDate, sourcePeriod, sourceDoctor, reason, batchNo) {
  return `【改期失败通知】尊敬的${patientName}您好，您预约的${sourceDate} ${sourcePeriod} ${sourceDoctor}医生改期未成功，原因：${reason}。改期批次号：${batchNo}。请联系前台重新办理。`;
}

function generateCancelledNotification(patientName, sourceDate, sourcePeriod, sourceDoctor, batchNo) {
  return `【改期撤销通知】尊敬的${patientName}您好，您的改期申请已被撤销，已恢复原预约：${sourceDate} ${sourcePeriod} ${sourceDoctor}医生。改期批次号：${batchNo}。给您带来不便敬请谅解。`;
}

const rescheduleService = {
  createDraftBatch(req, title, reason, remarks) {
    const batch = dao.createBatch(title, reason, req.user.id, remarks);
    logAudit(req, {
      action: 'reschedule_batch_created',
      entityType: 'reschedule_batch',
      entityId: batch.id,
      reason: `创建改期批次草稿: ${title}`
    });
    return batch;
  },

  getBatchDetail(batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) return null;
    const items = dao.getItemsByBatch(batchId);
    const results = dao.getResultsByBatch(batchId);
    const notifications = dao.getNotificationsByBatch(batchId);
    const revocation = dao.getRevocationByBatch(batchId);
    const successCount = items.filter(i => i.status === 'success').length;
    const failedCount = items.filter(i => i.status === 'failed').length;
    const pendingCount = items.filter(i => i.status === 'pending').length;
    return {
      batch,
      items,
      results,
      notifications,
      revocation,
      stats: {
        total: items.length,
        success: successCount,
        failed: failedCount,
        pending: pendingCount
      }
    };
  },

  listBatches(status) {
    return dao.listBatches(status);
  },

  getConfig() {
    return {
      reschedule_allow_cross_doctor: dao.getConfig('reschedule_allow_cross_doctor') === 'true',
      reschedule_auto_fill_waitlist: dao.getConfig('reschedule_auto_fill_waitlist') === 'true',
      reschedule_clerk_can_submit: dao.getConfig('reschedule_clerk_can_submit') === 'true'
    };
  },

  updateConfig(req, key, value) {
    const validKeys = ['reschedule_allow_cross_doctor', 'reschedule_auto_fill_waitlist', 'reschedule_clerk_can_submit'];
    if (!validKeys.includes(key)) {
      throw new Error('不支持的配置键');
    }
    const oldVal = dao.getConfig(key);
    const strVal = String(value);
    db.prepare(`
      INSERT INTO config (key, value, updated_at, updated_by) VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by
    `).run(key, strVal, req.user.id);
    logAudit(req, {
      action: 'update_reschedule_config',
      entityType: 'config',
      entityId: key,
      oldValue: { [key]: oldVal },
      newValue: { [key]: strVal },
      reason: `更新改期配置: ${key}`
    });
    return { key, oldValue: oldVal, newValue: strVal };
  },

  addBatchItems(req, batchId, items) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');
    if (!['draft'].includes(batch.status)) {
      throw new Error('只能在草稿状态下添加条目');
    }

    dao.clearItems(batchId);

    for (const item of items) {
      if (item.source_type === 'appointment') {
        const appt = dao.getAppointmentById(item.source_id);
        if (!appt) throw new Error(`预约不存在: ${item.source_id}`);
        if (!['booked', 'confirmed'].includes(appt.status)) {
          throw new Error(`预约状态不支持改期: ${appt.status}`);
        }
        dao.addItem(batchId, 'appointment', item.source_id, appt.patient_id, appt.slot_id);
      } else if (item.source_type === 'waitlist') {
        const wait = dao.getWaitlistById(item.source_id);
        if (!wait) throw new Error(`候补记录不存在: ${item.source_id}`);
        if (!['waiting', 'notifying'].includes(wait.status)) {
          throw new Error(`候补状态不支持改期: ${wait.status}`);
        }
        dao.addItem(batchId, 'waitlist', item.source_id, wait.patient_id, wait.slot_id);
      } else {
        throw new Error(`不支持的来源类型: ${item.source_type}`);
      }
    }

    logAudit(req, {
      action: 'reschedule_items_updated',
      entityType: 'reschedule_batch',
      entityId: batchId,
      newValue: { itemCount: items.length },
      reason: '更新改期批次条目'
    });

    return dao.getItemsByBatch(batchId);
  },

  setItemTargets(req, batchId, targetMap) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');
    if (!['draft', 'previewed'].includes(batch.status)) {
      throw new Error('只能在草稿或预览状态下设置目标号源');
    }

    const allowCrossDoctor = dao.getConfig('reschedule_allow_cross_doctor') === 'true';
    const items = dao.getItemsByBatch(batchId);

    for (const item of items) {
      const targetSlotId = targetMap[item.id];
      if (!targetSlotId) continue;

      const targetSlot = dao.getSlotWithDetail(targetSlotId);
      if (!targetSlot) throw new Error(`目标号源不存在: ${targetSlotId}`);

      if (!allowCrossDoctor && targetSlot.doctor_id !== item.source_doctor_name) {
        const sourceSlot = dao.getSlotWithDetail(item.source_slot_id);
        if (sourceSlot.doctor_id !== targetSlot.doctor_id) {
          throw new Error(`不允许跨医生改期，请联系管理员`);
        }
      }

      dao.updateItemTarget(item.id, targetSlotId);
    }

    logAudit(req, {
      action: 'reschedule_targets_set',
      entityType: 'reschedule_batch',
      entityId: batchId,
      newValue: { targetCount: Object.keys(targetMap).length },
      reason: '设置改期目标号源'
    });

    return dao.getItemsByBatch(batchId);
  },

  previewConflicts(batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');

    const items = dao.getItemsByBatch(batchId);
    const conflicts = [];
    const okItems = [];

    for (const item of items) {
      if (!item.target_slot_id) {
        conflicts.push({
          item_id: item.id,
          type: 'no_target',
          detail: '未设置目标号源',
          patient_name: item.patient_name
        });
        continue;
      }

      const targetSlot = dao.getSlotWithDetail(item.target_slot_id);
      if (!targetSlot) {
        conflicts.push({
          item_id: item.id,
          type: 'target_not_found',
          detail: '目标号源不存在',
          patient_name: item.patient_name
        });
        continue;
      }

      if (targetSlot.status !== 'active') {
        conflicts.push({
          item_id: item.id,
          type: 'slot_closed',
          detail: `目标号源已${targetSlot.status === 'full' ? '约满' : '关闭'}`,
          patient_name: item.patient_name
        });
        continue;
      }

      if (dao.checkSlotSuspended(item.target_slot_id)) {
        conflicts.push({
          item_id: item.id,
          type: 'slot_suspended',
          detail: '目标号源已停诊或锁定',
          patient_name: item.patient_name
        });
        continue;
      }

      const sourceApptId = item.source_type === 'appointment' ? item.source_id : null;
      if (dao.checkPatientDuplicateInSlot(item.patient_id, item.target_slot_id, sourceApptId)) {
        conflicts.push({
          item_id: item.id,
          type: 'duplicate_patient',
          detail: '该患者在目标号源已有预约',
          patient_name: item.patient_name
        });
        continue;
      }

      const available = targetSlot.capacity - targetSlot.booked_count;
      if (available <= 0) {
        const autoFill = dao.getConfig('reschedule_auto_fill_waitlist') === 'true';
        if (!autoFill) {
          conflicts.push({
            item_id: item.id,
            type: 'slot_full',
            detail: '目标号源已满且自动候补功能未开启',
            patient_name: item.patient_name
          });
          continue;
        }
      }

      okItems.push({
        item_id: item.id,
        patient_name: item.patient_name,
        source_slot_id: item.source_slot_id,
        target_slot_id: item.target_slot_id,
        target_date: targetSlot.date,
        target_period: targetSlot.period,
        target_doctor: targetSlot.doctor_name,
        target_available: available,
        will_waitlist: available <= 0
      });
    }

    return {
      total: items.length,
      okCount: okItems.length,
      conflictCount: conflicts.length,
      okItems,
      conflicts
    };
  },

  executeBatch(req, batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');
    if (!['draft', 'previewed'].includes(batch.status)) {
      throw new Error('只能执行草稿或预览状态的批次');
    }

    const clerkCanSubmit = dao.getConfig('reschedule_clerk_can_submit') === 'true';
    if (req.user.role !== 'admin' && !clerkCanSubmit) {
      throw new Error('办事员无提交权限，请联系管理员');
    }

    const preview = this.previewConflicts(batchId);
    const autoFillWaitlist = dao.getConfig('reschedule_auto_fill_waitlist') === 'true';
    const items = dao.getItemsByBatch(batchId);

    let successCount = 0;
    let failedCount = 0;
    let waitlistCount = 0;

    const tx = db.transaction(() => {
      dao.updateBatchStatus(batchId, 'executing', req.user.id);

      for (const item of items) {
        try {
          const result = this._processSingleItem(item, batch, autoFillWaitlist, req);
          if (result.success) {
            successCount++;
            if (result.waitlisted) waitlistCount++;
          } else {
            failedCount++;
          }
        } catch (e) {
          failedCount++;
          dao.updateItemStatus(item.id, 'failed', e.message, 'system_error', e.message);
          dao.addResult(batchId, item.id, item.patient_id, item.source_slot_id, item.target_slot_id, item.source_type, 'failed', e.message, null);
          if (item.source_type === 'appointment') {
            const content = generateFailedNotification(item.patient_name, item.source_date, item.source_period, item.source_doctor_name, e.message, batch.batch_no);
            dao.addNotification(batchId, item.patient_id, item.source_id, null, 'reschedule_failed', content);
          }
        }
      }

      dao.updateBatchStatus(batchId, 'completed', req.user.id);
    });

    tx();

    logAudit(req, {
      action: 'reschedule_batch_executed',
      entityType: 'reschedule_batch',
      entityId: batchId,
      newValue: { successCount, failedCount, waitlistCount },
      reason: '执行改期批次'
    });

    return {
      batchId,
      stats: {
        total: items.length,
        success: successCount,
        failed: failedCount,
        waitlisted: waitlistCount
      }
    };
  },

  _processSingleItem(item, batch, autoFillWaitlist, req) {
    if (!item.target_slot_id) {
      dao.updateItemStatus(item.id, 'skipped', '未设置目标号源', 'no_target', null);
      dao.addResult(batch.id, item.id, item.patient_id, item.source_slot_id, null, item.source_type, 'skipped', '未设置目标号源', null);
      return { success: false, waitlisted: false };
    }

    const targetSlot = dao.getSlotWithDetail(item.target_slot_id);
    if (!targetSlot || targetSlot.status !== 'active') {
      throw new Error('目标号源不可用');
    }

    if (dao.checkSlotSuspended(item.target_slot_id)) {
      throw new Error('目标号源已停诊或锁定');
    }

    const sourceApptId = item.source_type === 'appointment' ? item.source_id : null;
    if (dao.checkPatientDuplicateInSlot(item.patient_id, item.target_slot_id, sourceApptId)) {
      throw new Error('该患者在目标号源已有预约');
    }

    const available = targetSlot.capacity - targetSlot.booked_count;

    if (available > 0) {
      return this._reserveDirect(item, batch, targetSlot);
    } else if (autoFillWaitlist) {
      return this._addToTargetWaitlist(item, batch, targetSlot);
    } else {
      throw new Error('目标号源已满');
    }
  },

  _reserveDirect(item, batch, targetSlot) {
    const snapshot = {};

    if (item.source_type === 'appointment') {
      const appt = dao.getAppointmentById(item.source_id);
      snapshot.sourceAppointment = { id: appt.id, status: appt.status, slot_id: appt.slot_id };

      db.prepare("UPDATE appointments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.source_id);
      db.prepare('UPDATE slots SET available_count = available_count + 1 WHERE id = ?').run(item.source_slot_id);
      const sourceSlot = dao.getSlotWithDetail(item.source_slot_id);
      if (sourceSlot.available_count + 1 > 0 && sourceSlot.status === 'full') {
        db.prepare("UPDATE slots SET status = 'active' WHERE id = ?").run(item.source_slot_id);
      }
    } else if (item.source_type === 'waitlist') {
      const wait = dao.getWaitlistById(item.source_id);
      snapshot.sourceWaitlist = { id: wait.id, status: wait.status, slot_id: wait.slot_id, position: wait.position };

      db.prepare("UPDATE waitlist SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.source_id);
    }

    const existingAppt = db.prepare(`
      SELECT id FROM appointments WHERE patient_id = ? AND slot_id = ? AND status IN ('booked', 'confirmed')
    `).get(item.patient_id, item.target_slot_id);

    let newApptId;
    if (existingAppt) {
      newApptId = existingAppt.id;
    } else {
      const r = db.prepare(`
        INSERT INTO appointments (slot_id, patient_id, status, created_at, updated_at)
        VALUES (?, ?, 'booked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(item.target_slot_id, item.patient_id);
      newApptId = r.lastInsertRowid;
    }
    snapshot.newAppointmentId = newApptId;

    db.prepare('UPDATE slots SET available_count = available_count - 1 WHERE id = ?').run(item.target_slot_id);
    const targetAfter = dao.getSlotWithDetail(item.target_slot_id);
    if (targetAfter.available_count - 1 <= 0) {
      db.prepare("UPDATE slots SET status = 'full' WHERE id = ?").run(item.target_slot_id);
    }

    dao.updateItemSuccess(item.id, newApptId, null,
      item.source_type === 'appointment' ? (snapshot.sourceAppointment?.status || null) : null,
      item.source_type === 'waitlist' ? (snapshot.sourceWaitlist?.status || null) : null
    );
    dao.addResult(batch.id, item.id, item.patient_id, item.source_slot_id, item.target_slot_id, item.source_type, 'success', null, snapshot);

    const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' };
    const content = generateSuccessNotification(
      item.patient_name,
      item.source_date, periodMap[item.source_period] || item.source_period, item.source_doctor_name,
      targetSlot.date, periodMap[targetSlot.period] || targetSlot.period, targetSlot.doctor_name,
      batch.batch_no
    );
    dao.addNotification(batch.id, item.patient_id, newApptId, null, 'reschedule_success', content);

    return { success: true, waitlisted: false };
  },

  _addToTargetWaitlist(item, batch, targetSlot) {
    const snapshot = {};

    if (item.source_type === 'appointment') {
      const appt = dao.getAppointmentById(item.source_id);
      snapshot.sourceAppointment = { id: appt.id, status: appt.status, slot_id: appt.slot_id };

      db.prepare("UPDATE appointments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.source_id);
      db.prepare('UPDATE slots SET available_count = available_count + 1 WHERE id = ?').run(item.source_slot_id);
      const sourceSlot = dao.getSlotWithDetail(item.source_slot_id);
      if (sourceSlot.available_count + 1 > 0 && sourceSlot.status === 'full') {
        db.prepare("UPDATE slots SET status = 'active' WHERE id = ?").run(item.source_slot_id);
      }
    } else if (item.source_type === 'waitlist') {
      const wait = dao.getWaitlistById(item.source_id);
      snapshot.sourceWaitlist = { id: wait.id, status: wait.status, slot_id: wait.slot_id, position: wait.position };

      db.prepare("UPDATE waitlist SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.source_id);
    }

    const waitingCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM waitlist
      WHERE slot_id = ? AND status IN ('waiting', 'notifying')
    `).get(item.target_slot_id).cnt;

    const newPosition = waitingCount + 1;
    const r = db.prepare(`
      INSERT INTO waitlist (slot_id, patient_id, position, status, created_at, updated_at)
      VALUES (?, ?, ?, 'waiting', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(item.target_slot_id, item.patient_id, newPosition);
    const newWaitlistId = r.lastInsertRowid;
    snapshot.newWaitlistId = newWaitlistId;

    dao.updateItemSuccess(item.id, null, newWaitlistId,
      item.source_type === 'appointment' ? (snapshot.sourceAppointment?.status || null) : null,
      item.source_type === 'waitlist' ? (snapshot.sourceWaitlist?.status || null) : null
    );
    dao.addResult(batch.id, item.id, item.patient_id, item.source_slot_id, item.target_slot_id, item.source_type, 'success', '已加入候补', snapshot);

    const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' };
    const content = generateWaitlistNotification(
      item.patient_name,
      item.source_date, periodMap[item.source_period] || item.source_period, item.source_doctor_name,
      targetSlot.date, periodMap[targetSlot.period] || targetSlot.period, targetSlot.doctor_name,
      batch.batch_no
    );
    dao.addNotification(batch.id, item.patient_id, null, newWaitlistId, 'reschedule_auto_waitlist', content);

    return { success: true, waitlisted: true };
  },

  revokeBatch(req, batchId, reason) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');
    if (batch.status !== 'completed') {
      throw new Error('只能撤销已完成的批次');
    }

    const results = dao.getResultsByBatch(batchId);
    let restoredAppointments = 0;
    let restoredWaitlist = 0;
    let restoredSlots = 0;

    const tx = db.transaction(() => {
      for (const result of results) {
        if (result.result !== 'success') continue;
        if (!result.rollback_snapshot) continue;

        let snapshot;
        try {
          snapshot = JSON.parse(result.rollback_snapshot);
        } catch { continue; }

        if (result.source_type === 'appointment' && snapshot.sourceAppointment) {
          db.prepare('UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(snapshot.sourceAppointment.status, snapshot.sourceAppointment.id);
          restoredAppointments++;
        }
        if (result.source_type === 'waitlist' && snapshot.sourceWaitlist) {
          db.prepare('UPDATE waitlist SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(snapshot.sourceWaitlist.status, snapshot.sourceWaitlist.id);
          restoredWaitlist++;
        }

        if (snapshot.newAppointmentId) {
          const targetSlot = dao.getSlotWithDetail(result.target_slot_id);
          db.prepare('UPDATE slots SET available_count = available_count + 1 WHERE id = ?').run(result.target_slot_id);
          if (targetSlot.available_count + 1 > 0 && targetSlot.status === 'full') {
            db.prepare("UPDATE slots SET status = 'active' WHERE id = ?").run(result.target_slot_id);
          }
          db.prepare("DELETE FROM appointments WHERE id = ?").run(snapshot.newAppointmentId);
        }
        if (snapshot.newWaitlistId) {
          db.prepare("DELETE FROM waitlist WHERE id = ?").run(snapshot.newWaitlistId);
        }

        if (result.source_type === 'appointment' && snapshot.sourceAppointment) {
          db.prepare('UPDATE slots SET available_count = available_count - 1 WHERE id = ?').run(result.source_slot_id);
          const srcSlot = dao.getSlotWithDetail(result.source_slot_id);
          if (srcSlot.available_count - 1 <= 0) {
            db.prepare("UPDATE slots SET status = 'full' WHERE id = ?").run(result.source_slot_id);
          }
          restoredSlots++;
        }
        if (result.source_type === 'waitlist' && snapshot.sourceWaitlist) {
          restoredSlots++;
        }

        dao.updateItemStatus(result.item_id, 'cancelled', '已撤销回滚', 'revoked', null);

        const item = db.prepare('SELECT * FROM reschedule_items WHERE id = ?').get(result.item_id);
        const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' };
        const content = generateCancelledNotification(
          result.patient_name,
          result.source_date || '', periodMap[result.source_period] || '', result.source_doctor_name || '',
          batch.batch_no
        );
        dao.addNotification(batchId, result.patient_id, null, null, 'reschedule_cancelled', content);
      }

      dao.updateBatchStatus(batchId, 'revoked', req.user.id);
      dao.addRevocation(batchId, reason, restoredAppointments, restoredWaitlist, restoredSlots, req.user.id);
    });

    tx();

    logAudit(req, {
      action: 'reschedule_batch_revoked',
      entityType: 'reschedule_batch',
      entityId: batchId,
      newValue: { restoredAppointments, restoredWaitlist, restoredSlots },
      reason: reason || '撤销改期批次'
    });

    return {
      batchId,
      restoreStats: {
        restoredAppointments,
        restoredWaitlist,
        restoredSlots
      }
    };
  },

  revokeSingleItem(req, batchId, itemId, reason) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');
    if (batch.status !== 'completed') {
      throw new Error('只能撤销已完成批次中的条目');
    }

    const item = db.prepare('SELECT * FROM reschedule_items WHERE id = ? AND batch_id = ?').get(itemId, batchId);
    if (!item) throw new Error('条目不存在');
    if (item.status !== 'success') throw new Error('只有成功的条目可以撤销');

    const result = db.prepare('SELECT * FROM reschedule_results WHERE item_id = ? AND batch_id = ?').get(itemId, batchId);
    if (!result || !result.rollback_snapshot) throw new Error('没有回滚快照');

    let snapshot;
    try { snapshot = JSON.parse(result.rollback_snapshot); } catch { throw new Error('回滚快照解析失败'); }

    const tx = db.transaction(() => {
      if (item.source_type === 'appointment' && snapshot.sourceAppointment) {
        db.prepare('UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(snapshot.sourceAppointment.status, snapshot.sourceAppointment.id);
      }
      if (item.source_type === 'waitlist' && snapshot.sourceWaitlist) {
        db.prepare('UPDATE waitlist SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(snapshot.sourceWaitlist.status, snapshot.sourceWaitlist.id);
      }

      if (snapshot.newAppointmentId) {
        const targetSlot = dao.getSlotWithDetail(item.target_slot_id);
        db.prepare('UPDATE slots SET available_count = available_count + 1 WHERE id = ?').run(item.target_slot_id);
        if (targetSlot.available_count + 1 > 0 && targetSlot.status === 'full') {
          db.prepare("UPDATE slots SET status = 'active' WHERE id = ?").run(item.target_slot_id);
        }
        db.prepare("DELETE FROM appointments WHERE id = ?").run(snapshot.newAppointmentId);
      }
      if (snapshot.newWaitlistId) {
        db.prepare("DELETE FROM waitlist WHERE id = ?").run(snapshot.newWaitlistId);
      }

      if (item.source_type === 'appointment' && snapshot.sourceAppointment) {
        db.prepare('UPDATE slots SET available_count = available_count - 1 WHERE id = ?').run(item.source_slot_id);
        const srcSlot = dao.getSlotWithDetail(item.source_slot_id);
        if (srcSlot.available_count - 1 <= 0) {
          db.prepare("UPDATE slots SET status = 'full' WHERE id = ?").run(item.source_slot_id);
        }
      }

      dao.updateItemStatus(itemId, 'cancelled', '单笔撤销回滚', 'single_revoked', reason);
      db.prepare('UPDATE reschedule_results SET result = ?, error_message = ? WHERE id = ?')
        .run('skipped', `单笔撤销: ${reason || '无原因'}`, result.id);

      const itemDetail = dao.getItemsByBatch(batchId).find(i => i.id === itemId);
      if (itemDetail) {
        const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' };
        const content = generateCancelledNotification(
          itemDetail.patient_name,
          itemDetail.source_date, periodMap[itemDetail.source_period] || '', itemDetail.source_doctor_name || '',
          batch.batch_no
        );
        dao.addNotification(batchId, itemDetail.patient_id, null, null, 'reschedule_cancelled', content);
      }
    });

    tx();

    logAudit(req, {
      action: 'reschedule_single_revoked',
      entityType: 'reschedule_item',
      entityId: itemId,
      slotId: item.source_slot_id,
      patientId: item.patient_id,
      newValue: { status: 'cancelled', reason: reason || '' },
      reason: `单笔撤销改期: ${reason || '无原因'}`
    });

    return { success: true, itemId };
  },

  findAvailableSlots(sourceSlotId, mode) {
    const sourceSlot = dao.getSlotWithDetail(sourceSlotId);
    if (!sourceSlot) throw new Error('源号源不存在');

    let slots;
    if (mode === 'same_doctor') {
      slots = dao.findSlotsByDateAndDoctor(null, sourceSlot.doctor_id, null);
    } else if (mode === 'same_department') {
      slots = dao.findSlotsByDateAndDoctor(null, null, sourceSlot.department);
    } else {
      slots = dao.findSlotsByDateAndDoctor(null, null, null);
    }

    return slots
      .filter(s => s.id !== sourceSlotId)
      .filter(s => !dao.checkSlotSuspended(s.id))
      .map(s => ({
        ...s,
        available: s.capacity - s.booked_count,
        can_direct_book: (s.capacity - s.booked_count) > 0
      }));
  },

  loadAppointmentsByDate(date, doctorId, department) {
    let sql = `
      SELECT a.*, p.name as patient_name, p.phone as patient_phone,
        s.date, s.period, s.time_start, s.time_end,
        d.name as doctor_name, d.department
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN slots s ON a.slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      WHERE a.status IN ('booked', 'confirmed')
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
    sql += ' ORDER BY s.date, s.period, d.name, a.created_at';
    return db.prepare(sql).all(...params);
  },

  loadWaitlistByDate(date, doctorId, department) {
    let sql = `
      SELECT w.*, p.name as patient_name, p.phone as patient_phone,
        s.date, s.period, s.time_start, s.time_end,
        d.name as doctor_name, d.department
      FROM waitlist w
      JOIN patients p ON w.patient_id = p.id
      JOIN slots s ON w.slot_id = s.id
      JOIN doctors d ON s.doctor_id = d.id
      WHERE w.status IN ('waiting', 'notifying')
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
    sql += ' ORDER BY s.date, s.period, d.name, w.position';
    return db.prepare(sql).all(...params);
  }
};

module.exports = rescheduleService;
