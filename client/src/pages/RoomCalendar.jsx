import { useState, useEffect, useMemo } from 'react'
import { roomApi, suspensionApi, toast } from '../api.js'

const periodMap = {
  morning: { label: '上午', time: '08:00-12:00', color: 'bg-sky-50 border-sky-200' },
  afternoon: { label: '下午', time: '14:00-17:30', color: 'bg-amber-50 border-amber-200' },
  evening: { label: '晚间', time: '18:00-20:00', color: 'bg-violet-50 border-violet-200' }
}

function RoomCalendar({ user }) {
  const [rooms, setRooms] = useState([])
  const [doctors, setDoctors] = useState([])
  const [calendar, setCalendar] = useState(null)
  const [loading, setLoading] = useState(false)

  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 6)
    return d.toISOString().split('T')[0]
  })
  const [filterRoom, setFilterRoom] = useState('')
  const [filterDoctor, setFilterDoctor] = useState('')
  const [viewMode, setViewMode] = useState('room')

  const [showLockDialog, setShowLockDialog] = useState(false)
  const [lockForm, setLockForm] = useState({ roomId: '', date: '', period: '', title: '', reason: '' })
  const [lockPreview, setLockPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const canEdit = user.role === 'admin'

  useEffect(() => {
    loadRooms()
    loadDoctors()
  }, [])

  useEffect(() => {
    if (rooms.length > 0) loadCalendar()
  }, [startDate, endDate, filterRoom, filterDoctor])

  const loadRooms = async () => {
    try {
      const res = await roomApi.list()
      setRooms(res.data.list || [])
    } catch (e) {
      toast(e.response?.data?.error || '加载诊室失败', 'error')
    }
  }

  const loadDoctors = async () => {
    try {
      const res = await suspensionApi.getDoctors()
      setDoctors(res.data.doctors || res.data.list || [])
    } catch (_) {}
  }

  const loadCalendar = async () => {
    try {
      setLoading(true)
      const params = { startDate, endDate }
      if (filterRoom) params.roomId = filterRoom
      if (filterDoctor) params.doctorId = filterDoctor
      const res = await roomApi.calendar(params)
      setCalendar(res.data)
    } catch (e) {
      toast(e.response?.data?.error || '加载日历失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const dateList = useMemo(() => {
    if (!startDate || !endDate) return []
    const dates = []
    const start = new Date(startDate)
    const end = new Date(endDate)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0])
    }
    return dates
  }, [startDate, endDate])

  const groupedByRoomAndDate = useMemo(() => {
    if (!calendar?.slots) return {}
    const map = {}
    for (const slot of calendar.slots) {
      const key = `${slot.room_id || 'none'}_${slot.date}`
      if (!map[key]) map[key] = []
      map[key].push(slot)
    }
    return map
  }, [calendar])

  const openLockDialog = (roomId, date) => {
    if (!canEdit) {
      toast('只有管理员可以创建诊室锁定', 'error')
      return
    }
    setLockForm({ roomId: String(roomId || ''), date: date || '', period: '', title: '', reason: '' })
    setLockPreview(null)
    setShowLockDialog(true)
  }

  const previewLock = async () => {
    if (!lockForm.roomId || !lockForm.date) {
      toast('请选择诊室和日期', 'error')
      return
    }
    try {
      setPreviewLoading(true)
      const params = { date: lockForm.date }
      if (lockForm.period) params.period = lockForm.period
      const res = await roomApi.previewLock(parseInt(lockForm.roomId), params)
      setLockPreview(res.data)
    } catch (e) {
      toast(e.response?.data?.error || '预览失败', 'error')
    } finally {
      setPreviewLoading(false)
    }
  }

  const createLock = async () => {
    if (!canEdit) return
    if (!lockForm.roomId || !lockForm.date || !lockForm.title) {
      toast('诊室、日期、标题必填', 'error')
      return
    }
    if (!lockPreview) {
      toast('请先预览影响再创建', 'error')
      return
    }
    try {
      const batchRes = await suspensionApi.createBatch({
        title: lockForm.title,
        reason: lockForm.reason,
        remarks: `诊室锁定：诊室${lockForm.roomId} ${lockForm.date} ${lockForm.period || '全天'}`
      })
      const batchId = batchRes.data.batch.id

      const items = [{ type: 'room', value: String(lockForm.roomId), description: lockForm.reason || '诊室锁定' }]
      if (lockForm.period) items.push({ type: 'date', value: lockForm.date, description: '锁定日期' })
      else items.push({ type: 'date', value: lockForm.date, description: '全天锁定' })
      await suspensionApi.updateItems(batchId, items)

      const saveRes = await suspensionApi.saveDraft(batchId)
      toast(`锁定草稿已保存：${saveRes.data.slotCount}个号源，${saveRes.data.appointmentCount}个预约`, 'success')

      setShowLockDialog(false)
      loadCalendar()
    } catch (e) {
      toast(e.response?.data?.error || '创建锁定失败', 'error')
    }
  }

  const exportCsv = async (type) => {
    toast('请前往停诊改期页面，选择对应批次导出', 'info')
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">诊室资源占用日历</h1>
          <p className="text-gray-500 text-sm mt-1">按日期、诊室、医生查看号源、预约、候补和锁定情况</p>
        </div>
        <div className="flex gap-2">
          <div className="flex gap-1 bg-gray-100 rounded-md p-0.5">
            <button onClick={() => setViewMode('room')} className={`px-3 py-1 text-sm rounded ${viewMode === 'room' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>按诊室</button>
            <button onClick={() => setViewMode('date')} className={`px-3 py-1 text-sm rounded ${viewMode === 'date' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>按日期</button>
          </div>
          {canEdit && (
            <button onClick={() => openLockDialog('', today)} className="btn btn-primary">
              + 新建诊室锁定
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">开始日期</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">结束日期</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">诊室</label>
            <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)} className="input">
              <option value="">全部诊室</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name} - {r.location || ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">医生</label>
            <select value={filterDoctor} onChange={e => setFilterDoctor(e.target.value)} className="input">
              <option value="">全部医生</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.name} ({d.department})</option>)}
            </select>
          </div>
          <button onClick={loadCalendar} className="btn btn-secondary">🔄 刷新</button>
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-500">加载中...</div>}

      {calendar && !loading && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
            <div className="text-sm text-gray-600">
              共 <span className="font-medium">{calendar.slotCount}</span> 个号源，
              <span className="font-medium">{calendar.appointmentsCount}</span> 个预约，
              <span className="font-medium">{calendar.waitlistCount}</span> 个候补，
              <span className="font-medium">{calendar.locks?.length || 0}</span> 个锁定
            </div>
            <div className="flex gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300"></span>正常</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-100 border border-rose-300"></span>已锁定</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300"></span>约满</span>
            </div>
          </div>

          {viewMode === 'room' && rooms.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 z-10 w-32">诊室 / 日期</th>
                    {dateList.map(d => (
                      <th key={d} className="px-2 py-2 text-center font-medium text-gray-600 min-w-[120px]">
                        <div>{d}</div>
                        <div className="text-xs text-gray-400 font-normal">
                          {['周日','周一','周二','周三','周四','周五','周六'][new Date(d).getDay()]}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rooms.filter(r => !filterRoom || String(r.id) === filterRoom).map(room => (
                    <tr key={room.id} className="border-t">
                      <td className="px-3 py-2 font-medium text-gray-700 sticky left-0 bg-white z-10">
                        <div>{room.name}</div>
                        <div className="text-xs text-gray-400 font-normal">{room.location || ''}</div>
                      </td>
                      {dateList.map(d => {
                        const slots = groupedByRoomAndDate[`${room.id}_${d}`] || []
                        return (
                          <td key={d} className="px-1 py-2 align-top">
                            <div className="space-y-1">
                              {slots.map(slot => (
                                <div key={slot.id}
                                  className={`p-2 rounded border text-xs cursor-pointer hover:shadow-md transition ${
                                    slot.is_locked ? 'bg-rose-50 border-rose-300' :
                                    slot.status === 'full' ? 'bg-amber-50 border-amber-200' :
                                    'bg-emerald-50 border-emerald-200'
                                  }`}
                                  onClick={() => {
                                    if (slot.is_locked) {
                                      toast(`该时段已锁定：${slot.lock?.title || ''}`, 'info')
                                    }
                                  }}
                                >
                                  <div className="flex items-center justify-between font-medium">
                                    <span>{slot.doctor_name}</span>
                                    <span className={`text-xs px-1 rounded ${
                                      periodMap[slot.period]?.color || 'bg-gray-100'
                                    }`}>{periodMap[slot.period]?.label}</span>
                                  </div>
                                  <div className="text-gray-500 mt-0.5">
                                    预约 {slot.appointment_count} / 候补 {slot.waitlist_count}
                                  </div>
                                  {slot.is_locked && (
                                    <div className="mt-1 text-rose-600 font-medium">
                                      🔒 {slot.lock?.title || '已锁定'}
                                    </div>
                                  )}
                                </div>
                              ))}
                              {canEdit && slots.length === 0 && (
                                <button
                                  onClick={() => openLockDialog(room.id, d)}
                                  className="w-full p-2 text-xs text-gray-400 border border-dashed border-gray-200 rounded hover:border-primary-400 hover:text-primary-500 transition"
                                >
                                  + 加锁定
                                </button>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {viewMode === 'date' && dateList.length > 0 && (
            <div className="divide-y">
              {dateList.map(d => {
                const daySlots = calendar.byDate?.[d] || []
                const dayLocks = (calendar.locks || []).filter(l => false).length
                return (
                  <div key={d} className="p-4">
                    <div className="font-medium text-gray-700 mb-3 flex items-center justify-between">
                      <span>{d} ({['周日','周一','周二','周三','周四','周五','周六'][new Date(d).getDay()]})</span>
                      <span className="text-xs text-gray-400">{daySlots.length} 个号源</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {daySlots.map(slot => (
                        <div key={slot.id}
                          className={`p-3 rounded-lg border ${
                            slot.is_locked ? 'bg-rose-50 border-rose-300' :
                            slot.status === 'full' ? 'bg-amber-50 border-amber-200' :
                            'bg-emerald-50 border-emerald-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{slot.doctor_name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${periodMap[slot.period]?.color || ''}`}>
                              {periodMap[slot.period]?.label} {slot.time_start}-{slot.time_end}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            🚪 {slot.room_name || '未分配诊室'} {slot.room_location ? `(${slot.room_location})` : ''}
                          </div>
                          <div className="text-xs text-gray-500 mt-2 flex gap-3">
                            <span>预约 {slot.appointment_count}</span>
                            <span>候补 {slot.waitlist_count}</span>
                            <span>容量 {slot.capacity}</span>
                          </div>
                          {slot.is_locked && (
                            <div className="mt-2 text-rose-600 text-sm font-medium">
                              🔒 {slot.lock?.title || '已锁定'}
                              <span className="text-xs text-rose-400 ml-2">{slot.lock?.reason || ''}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {showLockDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-auto m-4">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold">新建诊室锁定</h2>
              <button onClick={() => setShowLockDialog(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">诊室 *</label>
                  <select
                    value={lockForm.roomId}
                    onChange={e => { setLockForm({ ...lockForm, roomId: e.target.value }); setLockPreview(null); }}
                    className="input w-full"
                  >
                    <option value="">请选择诊室</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">日期 *</label>
                  <input
                    type="date"
                    value={lockForm.date}
                    onChange={e => { setLockForm({ ...lockForm, date: e.target.value }); setLockPreview(null); }}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">时段</label>
                  <select
                    value={lockForm.period}
                    onChange={e => { setLockForm({ ...lockForm, period: e.target.value }); setLockPreview(null); }}
                    className="input w-full"
                  >
                    <option value="">全天</option>
                    <option value="morning">上午</option>
                    <option value="afternoon">下午</option>
                    <option value="evening">晚间</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">标题 *</label>
                  <input
                    type="text"
                    placeholder="如：设备检修、临时消杀、教学占用"
                    value={lockForm.title}
                    onChange={e => setLockForm({ ...lockForm, title: e.target.value })}
                    className="input w-full"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">原因说明</label>
                <textarea
                  rows="2"
                  value={lockForm.reason}
                  onChange={e => setLockForm({ ...lockForm, reason: e.target.value })}
                  className="input w-full"
                  placeholder="可选，填写锁定原因"
                />
              </div>

              <div className="flex items-center justify-between">
                <button onClick={previewLock} disabled={previewLoading} className="btn btn-secondary">
                  {previewLoading ? '预览中...' : '🔍 预览影响'}
                </button>
                <div className="text-xs text-gray-400">
                  先预览受影响的号源、预约和候补，再确认创建
                </div>
              </div>

              {lockPreview && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between">
                    <span className="font-medium text-sm">影响预览</span>
                    <span className="text-xs text-gray-500">
                      诊室：{lockPreview.room?.name} | 日期：{lockPreview.date} | 时段：{lockPreview.period === 'all' ? '全天' : periodMap[lockPreview.period]?.label || ''}
                    </span>
                  </div>
                  <div className="p-4 space-y-3 max-h-64 overflow-auto">
                    <div className="flex gap-4 text-sm">
                      <div className="bg-sky-50 px-3 py-2 rounded">
                        <div className="text-sky-600 font-medium text-lg">{lockPreview.slotCount}</div>
                        <div className="text-xs text-sky-500">个号源</div>
                      </div>
                      <div className="bg-amber-50 px-3 py-2 rounded">
                        <div className="text-amber-600 font-medium text-lg">{lockPreview.appointmentCount}</div>
                        <div className="text-xs text-amber-500">个预约</div>
                      </div>
                      <div className="bg-violet-50 px-3 py-2 rounded">
                        <div className="text-violet-600 font-medium text-lg">{lockPreview.waitlistCount}</div>
                        <div className="text-xs text-violet-500">个候补</div>
                      </div>
                    </div>

                    {lockPreview.appointments?.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">受影响预约患者：</div>
                        <div className="text-xs space-y-1 max-h-24 overflow-auto">
                          {lockPreview.appointments.slice(0, 5).map(a => (
                            <div key={a.id} className="flex justify-between text-gray-600 bg-gray-50 px-2 py-1 rounded">
                              <span>{a.patient_name} ({a.phone || ''})</span>
                              <span className="text-gray-400">{a.status}</span>
                            </div>
                          ))}
                          {lockPreview.appointments.length > 5 && (
                            <div className="text-gray-400">还有 {lockPreview.appointments.length - 5} 位...</div>
                          )}
                        </div>
                      </div>
                    )}

                    {lockPreview.waitlist?.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">受影响候补患者：</div>
                        <div className="text-xs space-y-1 max-h-24 overflow-auto">
                          {lockPreview.waitlist.slice(0, 5).map(w => (
                            <div key={w.id} className="flex justify-between text-gray-600 bg-gray-50 px-2 py-1 rounded">
                              <span>第{w.position}位 - {w.patient_name}</span>
                              <span className="text-gray-400">{w.status}</span>
                            </div>
                          ))}
                          {lockPreview.waitlist.length > 5 && (
                            <div className="text-gray-400">还有 {lockPreview.waitlist.length - 5} 位...</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-2">
              <button onClick={() => setShowLockDialog(false)} className="btn btn-secondary">取消</button>
              <button
                onClick={createLock}
                disabled={!lockPreview}
                className="btn btn-primary"
              >
                确认创建锁定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default RoomCalendar
