const fs = require('fs');
const path = require('path');
const dao = require('./suspensionDao');
const { logAudit } = require('./audit');

function ensureExportDir() {
  const exportDir = path.join(__dirname, '..', 'exports');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  return exportDir;
}

function escapeCsvValue(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());
  return result;
}

const csvService = {
  importSuspensionList(req, fileContent) {
    const lines = fileContent.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) throw new Error('CSV 文件格式错误，至少需要表头和一行数据');

    const headerLine = lines[0].replace(/^\uFEFF/, '');
    const headers = parseCsvLine(headerLine).map(h => h.toLowerCase().trim());
    
    const typeIdx = headers.findIndex(h => h.includes('类型') || h.includes('type') || h === '停诊类型');
    const valueIdx = headers.findIndex(h => h.includes('值') || h.includes('value') || h.includes('日期') || h.includes('医生') || h.includes('诊室'));
    const descIdx = headers.findIndex(h => h.includes('描述') || h.includes('说明') || h.includes('description') || h.includes('备注'));

    if (typeIdx === -1 || valueIdx === -1) {
      throw new Error('CSV 缺少必要列：类型、值');
    }

    const items = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCsvLine(lines[i]);
        const type = values[typeIdx]?.trim();
        const value = values[valueIdx]?.trim();
        const desc = descIdx >= 0 ? values[descIdx]?.trim() : '';

        if (!type || !value) continue;

        let normalizedType = null;
        if (type.includes('日期') || type === 'date') normalizedType = 'date';
        else if (type.includes('医生') || type === 'doctor') normalizedType = 'doctor';
        else if (type.includes('诊室') || type === 'room') normalizedType = 'room';

        if (!normalizedType) {
          errors.push(`第 ${i + 1} 行：类型 "${type}" 不合法，应为：日期、医生、诊室`);
          continue;
        }

        items.push({
          type: normalizedType,
          value,
          description: desc || ''
        });
      } catch (e) {
        errors.push(`第 ${i + 1} 行解析失败：${e.message}`);
      }
    }

    logAudit(req, {
      action: 'suspension_import',
      entityType: 'suspension_batch',
      newValue: { itemCount: items.length, errorCount: errors.length },
      reason: '导入停诊名单'
    });

    return { items, errors, validCount: items.length, errorCount: errors.length };
  },

  exportAffectedPatients(req, batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');

    const appointments = dao.getAffectedAppointments(batchId);
    const waitlist = dao.getAffectedWaitlist(batchId);
    const includeContact = dao.getConfig('export_include_contact_info') === 'true';

    const headers = includeContact
      ? ['批次号', '类型', '患者姓名', '电话', '身份证', '就诊日期', '时段', '医生', '原状态', '处理状态', '处理结果', '处理备注', '通知内容']
      : ['批次号', '类型', '患者姓名', '就诊日期', '时段', '医生', '原状态', '处理状态', '处理结果', '处理备注', '通知内容'];

    const lines = [headers.map(escapeCsvValue).join(',')];
    const statusMap = { booked: '已预约', confirmed: '已确认', cancelled: '已取消', waiting: '等候中', notifying: '待确认' };
    const resultMap = { success: '成功', failed: '失败', skipped: '跳过', warning: '警告', pending_manual: '待人工' };

    for (const appt of appointments) {
      const row = includeContact
        ? [batch.batch_no, '预约', appt.patient_name, appt.phone, appt.id_card || '', appt.date, appt.period, appt.doctor_name, statusMap[appt.old_status] || appt.old_status,
          appt.processed ? '已处理' : '未处理',
          resultMap[appt.process_result] || appt.process_result || '',
          appt.process_note || '',
          appt.notification_content || '']
        : [batch.batch_no, '预约', appt.patient_name, appt.date, appt.period, appt.doctor_name, statusMap[appt.old_status] || appt.old_status,
            appt.processed ? '已处理' : '未处理',
            resultMap[appt.process_result] || appt.process_result || '',
            appt.process_note || '',
            appt.notification_content || ''];
      lines.push(row.map(escapeCsvValue).join(','));
    }

    for (const wait of waitlist) {
      const row = includeContact
      ? [batch.batch_no, '候补', wait.patient_name, wait.phone, wait.id_card || '', wait.date, wait.period, wait.doctor_name, statusMap[wait.old_status] || wait.old_status,
          wait.processed ? '已处理' : '未处理',
          resultMap[wait.process_result] || wait.process_result || '',
          wait.process_note || '',
          wait.notification_content || '']
      : [batch.batch_no, '候补', wait.patient_name, wait.date, wait.period, wait.doctor_name, statusMap[wait.old_status] || wait.old_status,
          wait.processed ? '已处理' : '未处理',
          resultMap[wait.process_result] || wait.process_result || '',
          wait.process_note || '',
          wait.notification_content || ''];
      lines.push(row.map(escapeCsvValue).join(','));
    }

    const csv = '\uFEFF' + lines.join('\n');
    const fileName = `受影响患者_${batch.batch_no}_${Date.now()}.csv`;
    const exportDir = ensureExportDir();
    const filePath = path.join(exportDir, fileName);
    fs.writeFileSync(filePath, csv, 'utf8');

    dao.addExportRecord(batchId, 'affected_patients', filePath, fileName, lines.length - 1, req.user.id);

    logAudit(req, {
      action: 'suspension_export_affected',
      entityType: 'suspension_batch',
      entityId: batchId,
      newValue: { recordCount: lines.length - 1, fileName },
      reason: `导出停诊批次 ${batch.batch_no} 受影响患者名单`
    });

    return { filePath, fileName, recordCount: lines.length - 1, csv };
  },

  exportProcessResults(req, batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');

    const appointments = dao.getAffectedAppointments(batchId);
    const waitlist = dao.getAffectedWaitlist(batchId);
    const includeContact = dao.getConfig('export_include_contact_info') === 'true';

    const headers = includeContact
      ? ['批次号', '类型', '患者姓名', '电话', '就诊日期', '医生', '原状态', '新状态', '处理结果', '处理说明', '处理时间', '目标号源']
      : ['批次号', '类型', '患者姓名', '就诊日期', '医生', '原状态', '新状态', '处理结果', '处理说明', '处理时间', '目标号源'];

    const lines = [headers.map(escapeCsvValue).join(',')];
    const statusMap = { booked: '已预约', confirmed: '已确认', cancelled: '已取消', waiting: '等候中', notifying: '待确认' };
    const resultMap = { success: '成功', failed: '失败', skipped: '跳过', warning: '警告', pending_manual: '待人工' };

    for (const appt of appointments) {
      if (!appt.processed) continue;
      const row = includeContact
        ? [batch.batch_no, '预约', appt.patient_name, appt.phone, appt.date, appt.doctor_name,
            statusMap[appt.old_status] || appt.old_status,
            statusMap[appt.new_status] || appt.new_status || '',
            resultMap[appt.process_result] || appt.process_result || '',
            appt.process_note || '',
            appt.processed_at || '',
            '']
        : [batch.batch_no, '预约', appt.patient_name, appt.date, appt.doctor_name,
            statusMap[appt.old_status] || appt.old_status,
            statusMap[appt.new_status] || appt.new_status || '',
            resultMap[appt.process_result] || appt.process_result || '',
            appt.process_note || '',
            appt.processed_at || '',
            ''];
      lines.push(row.map(escapeCsvValue).join(','));
    }

    for (const wait of waitlist) {
      if (!wait.processed) continue;
      const row = includeContact
        ? [batch.batch_no, '候补', wait.patient_name, wait.phone, wait.date, wait.doctor_name,
            statusMap[wait.old_status] || wait.old_status,
            statusMap[wait.new_status] || wait.new_status || '',
            resultMap[wait.process_result] || wait.process_result || '',
            wait.process_note || '',
            wait.processed_at || '',
            wait.target_slot_id || '']
        : [batch.batch_no, '候补', wait.patient_name, wait.date, wait.doctor_name,
            statusMap[wait.old_status] || wait.old_status,
            statusMap[wait.new_status] || wait.new_status || '',
            resultMap[wait.process_result] || wait.process_result || '',
            wait.process_note || '',
            wait.processed_at || '',
            wait.target_slot_id || ''];
      lines.push(row.map(escapeCsvValue).join(','));
    }

    const csv = '\uFEFF' + lines.join('\n');
    const fileName = `处理结果_${batch.batch_no}_${Date.now()}.csv`;
    const exportDir = ensureExportDir();
    const filePath = path.join(exportDir, fileName);
    fs.writeFileSync(filePath, csv, 'utf8');

    dao.addExportRecord(batchId, 'process_results', filePath, fileName, lines.length - 1, req.user.id);

    logAudit(req, {
      action: 'suspension_export_results',
      entityType: 'suspension_batch',
      entityId: batchId,
      newValue: { recordCount: lines.length - 1, fileName },
      reason: `导出停诊批次 ${batch.batch_no} 处理结果`
    });

    return { filePath, fileName, recordCount: lines.length - 1, csv };
  },

  exportUnprocessed(req, batchId) {
    const batch = dao.getBatchById(batchId);
    if (!batch) throw new Error('批次不存在');

    const appointments = dao.getAffectedAppointments(batchId);
    const waitlist = dao.getAffectedWaitlist(batchId);
    const includeContact = dao.getConfig('export_include_contact_info') === 'true';

    const headers = includeContact
      ? ['批次号', '类型', '患者姓名', '电话', '就诊日期', '医生', '原状态', '未处理原因']
      : ['批次号', '类型', '患者姓名', '就诊日期', '医生', '原状态', '未处理原因'];

    const lines = [headers.map(escapeCsvValue).join(',')];
    const statusMap = { booked: '已预约', confirmed: '已确认', cancelled: '已取消', waiting: '等候中', notifying: '待确认' };

    for (const appt of appointments) {
      if (appt.processed) continue;
      const reason = appt.process_result || '系统未处理';
      const row = includeContact
        ? [batch.batch_no, '预约', appt.patient_name, appt.phone, appt.date, appt.doctor_name,
            statusMap[appt.old_status] || appt.old_status,
            reason]
        : [batch.batch_no, '预约', appt.patient_name, appt.date, appt.doctor_name,
            statusMap[appt.old_status] || appt.old_status,
            reason];
      lines.push(row.map(escapeCsvValue).join(','));
    }

    for (const wait of waitlist) {
      if (wait.processed) continue;
      const reason = wait.process_result || '系统未处理';
      const row = includeContact
        ? [batch.batch_no, '候补', wait.patient_name, wait.phone, wait.date, wait.doctor_name,
            statusMap[wait.old_status] || wait.old_status,
            reason]
        : [batch.batch_no, '候补', wait.patient_name, wait.date, wait.doctor_name,
            statusMap[wait.old_status] || wait.old_status,
            reason];
      lines.push(row.map(escapeCsvValue).join(','));
    }

    const csv = '\uFEFF' + lines.join('\n');
    const fileName = `未处理记录_${batch.batch_no}_${Date.now()}.csv`;
    const exportDir = ensureExportDir();
    const filePath = path.join(exportDir, fileName);
    fs.writeFileSync(filePath, csv, 'utf8');

    dao.addExportRecord(batchId, 'unprocessed', filePath, fileName, lines.length - 1, req.user.id);

    logAudit(req, {
      action: 'suspension_export_unprocessed',
      entityType: 'suspension_batch',
      entityId: batchId,
      newValue: { recordCount: lines.length - 1, fileName },
      reason: `导出停诊批次 ${batch.batch_no} 未处理记录`
    });

    return { filePath, fileName, recordCount: lines.length - 1, csv };
  },

  downloadExport(filePath, res) {
    if (!fs.existsSync(filePath)) {
      throw new Error('导出文件不存在');
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('路径不是文件');
    
    const fileName = path.basename(filePath);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }
};

module.exports = csvService;
