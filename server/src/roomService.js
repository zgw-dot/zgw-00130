const db = require('./db');
const roomDao = require('./roomDao');
const { logAudit } = require('./audit');

const roomService = {
  listRooms(status) {
    return roomDao.list(status);
  },

  getRoom(id) {
    return roomDao.getById(id);
  },

  createRoom(req, name, location) {
    if (!name || !name.trim()) {
      throw new Error('诊室名称不能为空');
    }
    const existing = roomDao.getByName(name.trim());
    if (existing) {
      throw new Error('诊室名称已存在');
    }
    const room = roomDao.create(name.trim(), location ? location.trim() : null);
    logAudit(req, {
      action: 'room_created',
      entityType: 'room',
      entityId: room.id,
      newValue: room,
      reason: '创建诊室'
    });
    return room;
  },

  updateRoom(req, id, data) {
    const existing = roomDao.getById(id);
    if (!existing) {
      throw new Error('诊室不存在');
    }
    if (data.name !== undefined) {
      const sameName = roomDao.getByName(data.name.trim());
      if (sameName && sameName.id !== id) {
        throw new Error('诊室名称已存在');
      }
      data.name = data.name.trim();
    }
    const room = roomDao.update(id, data);
    logAudit(req, {
      action: 'room_updated',
      entityType: 'room',
      entityId: id,
      oldValue: existing,
      newValue: room,
      reason: '更新诊室信息'
    });
    return room;
  },

  deleteRoom(req, id) {
    const existing = roomDao.getById(id);
    if (!existing) {
      throw new Error('诊室不存在');
    }
    const usingSlots = db.prepare(`
      SELECT COUNT(*) as cnt FROM slots WHERE room_id = ? AND status = 'active'
    `).get(id).cnt;
    if (usingSlots > 0) {
      throw new Error('该诊室有关联的有效号源，无法删除');
    }
    roomDao.remove(id);
    logAudit(req, {
      action: 'room_deleted',
      entityType: 'room',
      entityId: id,
      oldValue: existing,
      reason: '删除诊室'
    });
    return true;
  },

  getCalendar(startDate, endDate, roomId, doctorId) {
    if (!startDate || !endDate) {
      throw new Error('请指定开始和结束日期');
    }
    const slots = roomDao.getCalendarSlots(startDate, endDate, roomId, doctorId);
    const slotIds = slots.map(s => s.id);

    const appointments = slotIds.length > 0 ? roomDao.getAppointmentsBySlotIds(slotIds) : [];
    const waitlist = slotIds.length > 0 ? roomDao.getWaitlistBySlotIds(slotIds) : [];
    const locks = roomDao.getActiveRoomLocks(startDate, endDate, roomId);

    const lockSlotIds = new Set(locks.filter(l => l.slot_id).map(l => l.slot_id));

    const slotsWithDetails = slots.map(slot => {
      const slotAppts = appointments.filter(a => a.slot_id === slot.id);
      const slotWait = waitlist.filter(w => w.slot_id === slot.id);
      const isLocked = lockSlotIds.has(slot.id);
      const lockInfo = locks.find(l => l.slot_id === slot.id);
      return {
        ...slot,
        appointments: slotAppts,
        waitlist: slotWait,
        appointment_count: slotAppts.length,
        waitlist_count: slotWait.length,
        is_locked: isLocked,
        lock: lockInfo ? {
          batch_id: lockInfo.batch_id,
          batch_no: lockInfo.batch_no,
          title: lockInfo.title,
          reason: lockInfo.reason,
          status: lockInfo.status
        } : null
      };
    });

    const byDate = {};
    for (const slot of slotsWithDetails) {
      if (!byDate[slot.date]) byDate[slot.date] = [];
      byDate[slot.date].push(slot);
    }

    const lockBatches = [];
    const seenBatches = new Set();
    for (const lock of locks) {
      if (!seenBatches.has(lock.batch_id)) {
        seenBatches.add(lock.batch_id);
        lockBatches.push({
          batch_id: lock.batch_id,
          batch_no: lock.batch_no,
          title: lock.title,
          reason: lock.reason,
          status: lock.status,
          created_at: lock.created_at,
          executed_at: lock.executed_at
        });
      }
    }

    return {
      startDate,
      endDate,
      slotCount: slots.length,
      slots: slotsWithDetails,
      byDate,
      locks: lockBatches,
      appointmentsCount: appointments.length,
      waitlistCount: waitlist.length
    };
  },

  previewRoomLock(roomId, date, period) {
    const room = roomDao.getById(roomId);
    if (!room) {
      throw new Error('诊室不存在');
    }
    let slots = roomDao.getCalendarSlots(date, date, roomId, null);
    if (period) {
      slots = slots.filter(s => s.period === period);
    }
    const slotIds = slots.map(s => s.id);
    const appointments = slotIds.length > 0 ? roomDao.getAppointmentsBySlotIds(slotIds) : [];
    const waitlist = slotIds.length > 0 ? roomDao.getWaitlistBySlotIds(slotIds) : [];

    return {
      room,
      date,
      period: period || 'all',
      slots,
      slotCount: slots.length,
      appointments,
      appointmentCount: appointments.length,
      waitlist,
      waitlistCount: waitlist.length
    };
  }
};

module.exports = roomService;
