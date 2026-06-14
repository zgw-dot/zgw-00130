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

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const pad = (n) => n.toString().padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  const insertSlot = db.prepare(`
    INSERT OR IGNORE INTO slots (doctor_id, date, period, time_start, time_end, capacity, available_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    insertSlot.run(s.doctor, s.date, s.period, s.start, s.end, s.cap, s.avail, s.avail > 0 ? 'active' : 'full');
  });
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
    [7, 6, 'booked'],
    [7, 7, 'booked'],
    [7, 8, 'confirmed']
  ];
  appointments.forEach(a => insertAppointment.run(...a));
  console.log('预约数据初始化完成');

  db.forceSave();
  console.log('种子数据全部初始化完成！数据库已保存。');
})();
