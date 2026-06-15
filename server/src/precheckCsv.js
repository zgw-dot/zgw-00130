const { dao } = require('./precheckDao');
const precheckService = require('./precheckService');
const { logAudit } = require('./audit');
const fs = require('fs');
const path = require('path');

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result.map(s => s.trim());
}

function parseCsv(content) {
  let cleaned = content.replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] !== undefined ? cells[idx] : '';
    });
    result.push(row);
  }
  return result;
}

function toCsvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function rowsToCsv(headers, rows) {
  const lines = [headers.map(h => toCsvCell(h.label || h)).join(',')];
  for (const row of rows) {
    const cells = headers.map(h => {
      const key = h.key || h;
      const val = row[key];
      if (typeof h.format === 'function') return toCsvCell(h.format(val, row));
      return toCsvCell(val);
    });
    lines.push(cells.join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

const statusMap = {
  pending: '待核验',
  verified: '核验通过',
  frozen: '已冻结',
  released: '已放行',
  force_released: '强制放行',
  revoked: '已撤销',
  cancelled: '已取消',
  checked_in: '已签到'
};

const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' };
const boolMap = { 0: '未完成', 1: '已完成' };

const csvHandlers = {
  parseImportList(content) {
    const rows = parseCsv(content);
    const results = {
      parsed: rows.length,
      valid: [],
      invalid: [],
      errors: []
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const apptIdRaw = row['预约ID'] || row['appointment_id'] || row['appointmentId'] || row['id'] || '';
      const apptId = parseInt(apptIdRaw, 10);
      if (isNaN(apptId)) {
        results.invalid.push({ line: i + 2, row, error: '预约ID无效' });
        continue;
      }
      results.valid.push({ appointmentId: apptId, raw: row });
    }
    return results;
  },

  importFromCsv(req, content) {
    const parsed = csvHandlers.parseImportList(content);
    if (parsed.valid.length === 0) {
      return {
        ...parsed,
        imported: 0,
        skipped: 0,
        conflicts: [],
        message: parsed.invalid.length > 0 ? 'CSV 中没有有效的预约ID' : 'CSV 为空'
      };
    }

    const appointmentIds = parsed.valid.map(v => v.appointmentId);
    const appointments = appointmentIds
      .map(id => dao.getAppointmentById(id))
      .filter(a => a !== undefined && a !== null);

    const validIds = new Set(appointments.map(a => a.id));
    const notFound = parsed.valid.filter(v => !validIds.has(v.appointmentId));
    const invalidExtra = notFound.map(v => ({
      line: v.raw.__line || 0,
      row: v.raw,
      error: `预约ID ${v.appointmentId} 不存在`
    }));

    const result = precheckService.importAppointments(req, appointments);
    result.parsed = parsed.parsed;
    result.invalid = [...parsed.invalid, ...invalidExtra];
    result.validCount = appointments.length;

    return result;
  },

  exportRecordsByFilter(req, options = {}) {
    const { date = null, statuses = null, exportType = 'by_date' } = options;
    const records = dao.listRecords({
      date,
      statuses,
      limit: 10000,
      offset: 0
    });

    const headers = [
      { key: 'check_date', label: '核验日期' },
      { key: 'period', label: '时段', format: v => periodMap[v] || v || '' },
      { key: 'patient_name', label: '患者姓名' },
      { key: 'patient_phone', label: '电话' },
      { key: 'id_card', label: '身份证' },
      { key: 'doctor_name', label: '医生' },
      { key: 'department', label: '科室' },
      { key: 'time_start', label: '开始时间' },
      { key: 'status', label: '状态', format: v => statusMap[v] || v || '' },
      { key: 'lab_result', label: '化验', format: v => boolMap[v] || '未完成' },
      { key: 'lab_note', label: '化验备注' },
      { key: 'imaging_result', label: '影像', format: v => boolMap[v] || '未完成' },
      { key: 'imaging_note', label: '影像备注' },
      { key: 'consent_result', label: '知情同意', format: v => boolMap[v] || '未完成' },
      { key: 'consent_note', label: '知情同意备注' },
      { key: 'fasting_result', label: '禁食', format: v => boolMap[v] || '未完成' },
      { key: 'fasting_note', label: '禁食备注' },
      { key: 'freeze_reason', label: '冻结原因' },
      { key: 'release_note', label: '放行说明' },
      { key: 'revoke_reason', label: '撤销原因' },
      { key: 'import_batch', label: '导入批次' },
      { key: 'created_by_name', label: '创建人' },
      { key: 'created_at', label: '创建时间' },
      { key: 'frozen_by_name', label: '冻结人' },
      { key: 'frozen_at', label: '冻结时间' },
      { key: 'released_by_name', label: '放行/强制放行人' },
      { key: 'released_at', label: '放行时间' },
      { key: 'revoked_by_name', label: '撤销人' },
      { key: 'revoked_at', label: '撤销时间' }
    ];

    const csv = rowsToCsv(headers, records);
    const snapshotHash = dao.generateSnapshotHash(records);
    const dateTag = date || 'all';
    const typeTag = statuses ? statuses.join('_') : exportType;
    const timestamp = Date.now();
    const fileName = `术前核验_${dateTag}_${typeTag}_${timestamp}.csv`;

    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
    const filePath = path.join(exportsDir, fileName);
    fs.writeFileSync(filePath, csv, 'utf8');

    dao.addExportRecord({
      exportType: exportType,
      fileName,
      filePath,
      dateFilter: date,
      recordCount: records.length,
      snapshotHash,
      createdBy: req.user.id
    });

    logAudit(req, {
      action: 'precheck_export',
      entityType: 'precheck_export',
      newValue: { fileName, recordCount: records.length, date, statuses, snapshotHash },
      reason: `导出术前核验记录 ${date || '全部日期'} ${typeTag}`
    });

    return { csv, fileName, recordCount: records.length, snapshotHash, filePath };
  },

  generateTemplate() {
    const headers = [
      '预约ID', '核验日期', '患者姓名', '电话', '身份证',
      '医生', '科室', '时段', '开始时间',
      '化验(1=完成/0=未完成)', '化验备注',
      '影像(1=完成/0=未完成)', '影像备注',
      '知情同意(1=完成/0=未完成)', '知情同意备注',
      '禁食(1=完成/0=未完成)', '禁食备注'
    ];
    const sampleRows = [
      ['1', '2026-06-16', '示例患者', '13800000000', '110101199001010000',
       '张医生', '内科', '上午', '08:30',
       '1', '血常规、生化正常',
       '1', 'CT无异常',
       '1', '已签手术知情同意书',
       '1', '已禁食8小时']
    ];
    const lines = [headers.join(',')];
    for (const row of sampleRows) {
      lines.push(row.map(v => toCsvCell(v)).join(','));
    }
    return '\uFEFF' + lines.join('\n');
  }
};

module.exports = csvHandlers;
