const db = require('./db');
const dao = require('./rescheduleDao');
const { logAudit } = require('./audit');
const path = require('path');
const fs = require('fs');

const rescheduleCsv = {
  importRescheduleList(req, content) {
    if (!content || !content.trim()) {
      throw new Error('CSV 内容不能为空');
    }

    const lines = content.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV 至少需要包含标题行和一行数据');
    }

    const headerLine = lines[0].replace(/^\uFEFF/, '');
    const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));

    const typeIdx = headers.findIndex(h => h === '类型' || h === '来源类型' || h === 'source_type');
    const idIdx = headers.findIndex(h => h === '预约ID' || h === '候补ID' || h === 'ID' || h === 'source_id');
    const patientNameIdx = headers.findIndex(h => h === '患者姓名' || h === '姓名' || h === 'patient_name');
    const phoneIdx = headers.findIndex(h => h === '电话' || h === '手机号' || h === 'phone');
    const targetDateIdx = headers.findIndex(h => h === '目标日期' || h === 'target_date');
    const targetDoctorIdx = headers.findIndex(h => h === '目标医生' || h === 'target_doctor');

    if (typeIdx === -1 || idIdx === -1) {
      throw new Error('CSV 必须包含"类型"和"ID"列');
    }

    const items = [];
    const errors = [];
    const success = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cells = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
      const type = cells[typeIdx]?.trim();
      const idStr = cells[idIdx]?.trim();
      const targetDate = targetDateIdx >= 0 ? cells[targetDateIdx]?.trim() : null;
      const targetDoctor = targetDoctorIdx >= 0 ? cells[targetDoctorIdx]?.trim() : null;

      if (!type || !idStr) {
        errors.push({ line: i + 1, error: '类型或ID为空' });
        continue;
      }

      const id = parseInt(idStr, 10);
      if (isNaN(id)) {
        errors.push({ line: i + 1, error: 'ID必须是数字' });
        continue;
      }

      let sourceType;
      if (type === '预约' || type === 'appointment') {
        sourceType = 'appointment';
      } else if (type === '候补' || type === 'waitlist') {
        sourceType = 'waitlist';
      } else {
        errors.push({ line: i + 1, error: `不支持的类型: ${type}` });
        continue;
      }

      let targetSlotId = null;
      if (targetDate && targetDoctor) {
        const doctor = db.prepare('SELECT id FROM doctors WHERE name = ?').get(targetDoctor);
        if (doctor) {
          const slot = db.prepare(`
            SELECT id FROM slots
            WHERE doctor_id = ? AND date = ? AND status = 'active'
            ORDER BY CASE period WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3 END
            LIMIT 1
          `).get(doctor.id, targetDate);
          if (slot) targetSlotId = slot.id;
        }
      }

      items.push({
        source_type: sourceType,
        source_id: id,
        target_slot_id: targetSlotId,
        line: i + 1
      });
    }

    logAudit(req, {
      action: 'reschedule_csv_import',
      entityType: 'reschedule',
      entityId: null,
      newValue: { totalRows: lines.length - 1, successCount: items.length, errorCount: errors.length },
      reason: 'CSV导入待改期名单'
    });

    return {
      total: lines.length - 1,
      success: items.length,
      errors,
      items
    };
  },

  exportSuccessDetails(req, batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');

    const items = dao.getItemsByBatch(batchId).filter(i => i.status === 'success');

    const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' };
    const headers = ['条目ID', '患者姓名', '电话', '来源类型', '源号源日期', '源号源时段', '源医生', '目标号源日期', '目标号源时段', '目标医生', '状态', '结果说明', '处理时间'];
    const lines = [headers.join(',')];

    for (const item of items) {
      const sourceType = item.source_type === 'appointment' ? '预约' : '候补';
      const row = [
        item.id,
        item.patient_name,
        item.patient_phone || '',
        sourceType,
        item.source_date || '',
        periodMap[item.source_period] || item.source_period || '',
        item.source_doctor_name || '',
        item.target_date || '',
        periodMap[item.target_period] || item.target_period || '',
        item.target_doctor_name || '',
        '成功',
        item.result_message || '',
        item.processed_at || ''
      ];
      lines.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }

    const csv = '\uFEFF' + lines.join('\n');
    const fileName = `改期成功明细_${batch.batch_no}.csv`;

    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const filePath = path.join(exportsDir, fileName);
    fs.writeFileSync(filePath, csv, 'utf8');

    dao.addExportRecord(batchId, 'success_details', filePath, fileName, items.length, req.user.id);

    logAudit(req, {
      action: 'reschedule_export_success',
      entityType: 'reschedule_batch',
      entityId: batchId,
      newValue: { recordCount: items.length, fileName },
      reason: '导改期成功明细'
    });

    return { csv, fileName, recordCount: items.length };
  },

  exportFailureDetails(req, batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');

    const items = dao.getItemsByBatch(batchId).filter(i => i.status === 'failed');

    const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' };
    const headers = ['条目ID', '患者姓名', '电话', '来源类型', '源号源日期', '源号源时段', '源医生', '目标号源日期', '目标号源时段', '目标医生', '失败类型', '失败原因', '处理时间'];
    const lines = [headers.join(',')];

    for (const item of items) {
      const sourceType = item.source_type === 'appointment' ? '预约' : '候补';
      const conflictMap = {
        duplicate_patient: '患者重复',
        slot_full: '号源已满',
        slot_suspended: '号源停诊',
        slot_closed: '号源关闭',
        no_target: '无目标号源',
        system_error: '系统错误'
      };
      const row = [
        item.id,
        item.patient_name,
        item.patient_phone || '',
        sourceType,
        item.source_date || '',
        periodMap[item.source_period] || item.source_period || '',
        item.source_doctor_name || '',
        item.target_date || '',
        periodMap[item.target_period] || item.target_period || '',
        item.target_doctor_name || '',
        conflictMap[item.conflict_type] || item.conflict_type || '',
        item.result_message || item.conflict_detail || '',
        item.processed_at || ''
      ];
      lines.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }

    const csv = '\uFEFF' + lines.join('\n');
    const fileName = `改期失败明细_${batch.batch_no}.csv`;

    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const filePath = path.join(exportsDir, fileName);
    fs.writeFileSync(filePath, csv, 'utf8');

    dao.addExportRecord(batchId, 'failure_details', filePath, fileName, items.length, req.user.id);

    logAudit(req, {
      action: 'reschedule_export_failure',
      entityType: 'reschedule_batch',
      entityId: batchId,
      newValue: { recordCount: items.length, fileName },
      reason: '导出改期失败明细'
    });

    return { csv, fileName, recordCount: items.length };
  },

  exportAllDetails(req, batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');

    const items = dao.getItemsByBatch(batchId);

    const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' };
    const statusMap = { pending: '待处理', success: '成功', failed: '失败', skipped: '跳过', cancelled: '已撤销' };
    const headers = ['条目ID', '患者姓名', '电话', '来源类型', '源号源日期', '源号源时段', '源医生', '目标号源日期', '目标号源时段', '目标医生', '状态', '结果说明', '处理时间'];
    const lines = [headers.join(',')];

    for (const item of items) {
      const sourceType = item.source_type === 'appointment' ? '预约' : '候补';
      const row = [
        item.id,
        item.patient_name,
        item.patient_phone || '',
        sourceType,
        item.source_date || '',
        periodMap[item.source_period] || item.source_period || '',
        item.source_doctor_name || '',
        item.target_date || '',
        periodMap[item.target_period] || item.target_period || '',
        item.target_doctor_name || '',
        statusMap[item.status] || item.status,
        item.result_message || '',
        item.processed_at || ''
      ];
      lines.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }

    const csv = '\uFEFF' + lines.join('\n');
    const fileName = `改期全部明细_${batch.batch_no}.csv`;

    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const filePath = path.join(exportsDir, fileName);
    fs.writeFileSync(filePath, csv, 'utf8');

    dao.addExportRecord(batchId, 'all_details', filePath, fileName, items.length, req.user.id);

    logAudit(req, {
      action: 'reschedule_export_all',
      entityType: 'reschedule_batch',
      entityId: batchId,
      newValue: { recordCount: items.length, fileName },
      reason: '导出改期全部明细'
    });

    return { csv, fileName, recordCount: items.length };
  },

  listExports(batchId) {
    return dao.getExportRecords(batchId ? parseInt(batchId) : null);
  }
};

module.exports = rescheduleCsv;
