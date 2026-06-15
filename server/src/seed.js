const db = require('./db');
const bcrypt = require('bcryptjs');

(async () => {
  await db.ready;
  db.initTables();

  const hashAdmin = bcrypt.hashSync('admin123', 10);
  const hashClerk = bcrypt.hashSync('clerk123', 10);

  const insertUser = db.prepare(`INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)`);
  insertUser.run('admin', hashAdmin, 'admin');
  insertUser.run('clerk1', hashClerk, 'clerk');
  insertUser.run('clerk2', hashClerk, 'clerk');
  console.log('用户数据初始化完成: admin/admin123, clerk1/clerk123, clerk2/clerk123');

  const insertDoctor = db.prepare(`INSERT OR IGNORE INTO doctors (name, department, title) VALUES (?, ?, ?)`);
  const doctors = [
    ['张医生', '内科', '主任医师'],
    ['李医生', '外科', '副主任医师'],
    ['王医生', '儿科', '主治医师'],
    ['赵医生', '妇产科', '主任医师'],
    ['陈医生', '眼科', '副主任医师']
  ];
  doctors.forEach(d => insertDoctor.run(...d));
  console.log('医生数据初始化完成');

  const insertRoom = db.prepare(`INSERT OR IGNORE INTO rooms (name, location, status) VALUES (?, ?, ?)`);
  const rooms = [
    ['诊室101', '门诊楼1层东侧', 'active'],
    ['诊室102', '门诊楼1层西侧', 'active'],
    ['诊室201', '门诊楼2层东侧', 'active'],
    ['诊室202', '门诊楼2层西侧', 'active'],
    ['诊室301', '门诊楼3层东侧', 'active']
  ];
  rooms.forEach(r => insertRoom.run(...r));
  console.log('诊室数据初始化完成');

  const doctorRoomMap = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const pad = (n) => n.toString().padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  const insertSlot = db.prepare(`
    INSERT OR IGNORE INTO slots (doctor_id, room_id, date, period, time_start, time_end, capacity, available_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const schedules = [
    { doctor: 1, date: fmtDate(today), period: 'morning', start: '08:00', end: '12:00', cap: 20, avail: 5 },
    { doctor: 1, date: fmtDate(today), period: 'afternoon', start: '14:00', end: '17:30', cap: 15, avail: 0 },
    { doctor: 2, date: fmtDate(today), period: 'morning', start: '08:00', end: '12:00', cap: 20, avail: 0 },
    { doctor: 2, date: fmtDate(tomorrow), period: 'morning', start: '08:00', end: '12:00', cap: 25, avail: 8 },
    { doctor: 3, date: fmtDate(today), period: 'afternoon', start: '14:00', end: '17:30', cap: 30, avail: 12 },
    { doctor: 3, date: fmtDate(tomorrow), period: 'morning', start: '08:00', end: '12:00', cap: 30, avail: 15 },
    { doctor: 4, date: fmtDate(today), period: 'morning', start: '08:00', end: '12:00', cap: 15, avail: 2 },
    { doctor: 5, date: fmtDate(tomorrow), period: 'afternoon', start: '14:00', end: '17:30', cap: 20, avail: 6 }
  ];

  schedules.forEach(s => {
    insertSlot.run(s.doctor, doctorRoomMap[s.doctor], s.date, s.period, s.start, s.end, s.cap, s.avail, s.avail > 0 ? 'active' : 'full');
  });
  // 迁移回填：已存在但没有 room_id 的号源按医生-诊室映射补上
  try {
    const slotsWithoutRoom = db.prepare('SELECT id, doctor_id FROM slots WHERE room_id IS NULL').all();
    const updateSlotRoom = db.prepare('UPDATE slots SET room_id = ? WHERE id = ?');
    slotsWithoutRoom.forEach(s => {
      const roomId = doctorRoomMap[s.doctor_id];
      if (roomId) updateSlotRoom.run(roomId, s.id);
    });
    if (slotsWithoutRoom.length > 0) console.log(`已回填 ${slotsWithoutRoom.length} 个号源的诊室信息`);
  } catch (_) {}
  console.log('号源数据初始化完成');

  const insertPatient = db.prepare(`INSERT OR IGNORE INTO patients (name, phone, id_card) VALUES (?, ?, ?)`);
  const patients = [
    ['小明', '13800000001', '110101199001010001'],
    ['小红', '13800000002', '110101199001010002'],
    ['小刚', '13800000003', '110101199001010003'],
    ['小丽', '13800000004', '110101199001010004'],
    ['小华', '13800000005', '110101199001010005'],
    ['小强', '13800000006', '110101199001010006'],
    ['小芳', '13800000007', '110101199001010007'],
    ['小军', '13800000008', '110101199001010008']
  ];
  patients.forEach(p => insertPatient.run(...p));
  console.log('患者数据初始化完成');

  const insertAppointment = db.prepare(`
    INSERT OR IGNORE INTO appointments (slot_id, patient_id, status) VALUES (?, ?, ?)
  `);
  const appointments = [
    [1, 1, 'booked'],
    [1, 2, 'confirmed'],
    [2, 3, 'booked'],
    [3, 4, 'booked'],
    [4, 5, 'booked'],
    [4, 1, 'confirmed'],
    [4, 2, 'confirmed'],
    [7, 6, 'booked'],
    [7, 7, 'booked'],
    [7, 8, 'confirmed'],
    [5, 3, 'confirmed'],
    [5, 4, 'confirmed'],
    [6, 5, 'confirmed'],
    [6, 6, 'confirmed'],
    [8, 7, 'confirmed'],
    [8, 8, 'confirmed']
  ];
  appointments.forEach(a => insertAppointment.run(...a));
  console.log('预约数据初始化完成');

  const insertWaitlist = db.prepare(`
    INSERT OR IGNORE INTO waitlist (slot_id, patient_id, position, status) VALUES (?, ?, ?, ?)
  `);
  const waitlistEntries = [
    [1, 5, 1, 'waiting'],
    [1, 6, 2, 'waiting'],
    [2, 7, 1, 'waiting'],
    [2, 8, 2, 'waiting'],
    [4, 3, 1, 'waiting'],
    [4, 4, 2, 'waiting'],
    [7, 1, 1, 'waiting'],
    [7, 2, 2, 'waiting'],
    [5, 6, 1, 'waiting'],
    [5, 7, 2, 'waiting'],
    [6, 7, 1, 'waiting'],
    [6, 8, 2, 'waiting']
  ];
  waitlistEntries.forEach(w => insertWaitlist.run(...w));
  console.log('候补数据初始化完成');

  const insertPrecheck = db.prepare(`
    INSERT OR IGNORE INTO precheck_records
    (appointment_id, patient_id, slot_id, check_date, status,
     lab_result, lab_note, imaging_result, imaging_note,
     consent_result, consent_note, fasting_result, fasting_note,
     freeze_reason, import_batch, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tmrw = new Date(today);
  tmrw.setDate(today.getDate() + 1);
  const todayStr = fmtDate(today);
  const tmrwStr = fmtDate(tmrw);
  const adminId = 1;
  const batch = 'PRESEED' + todayStr.replace(/-/g, '') + '0001';

  const precheckSeeds = [
    [1, 1, 1, todayStr, 'verified', 1, '血常规、生化正常', 1, '胸部CT未见异常', 1, '手术同意书已签', 1, '禁食8小时', null, batch, adminId],
    [2, 2, 1, todayStr, 'frozen', 1, '血常规正常', 0, 'MRI报告未出', 1, '已签', 1, '已禁食', '影像检查未出结果', batch, adminId],
    [11, 3, 5, todayStr, 'pending', 1, '', 1, '', 0, '', 1, '', null, batch, adminId],
    [12, 4, 5, tmrwStr, 'pending', 0, '', 0, '', 0, '', 0, '', null, batch, adminId]
  ];
  precheckSeeds.forEach(p => insertPrecheck.run(...p));
  console.log('术前核验种子数据初始化完成');

  db.forceSave();
  console.log('种子数据全部初始化完成！数据库已保存。');
})();
