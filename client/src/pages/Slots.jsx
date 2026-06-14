import { useEffect, useState } from 'react'
import api, { toast } from '../api.js'
import { Link } from 'react-router-dom'
import { StatusBadge } from './Dashboard.jsx'

const periodMap = { morning: '上午', afternoon: '下午', evening: '晚间' }

export default function Slots() {
  const [slots, setSlots] = useState([])
  const [doctors, setDoctors] = useState([])
  const [filter, setFilter] = useState({ date: '', doctorId: '', status: '' })
  const [showNew, setShowNew] = useState(false)
  const [newSlot, setNewSlot] = useState({ doctor_id: '', date: new Date().toISOString().slice(0, 10), period: 'morning', time_start: '08:00', time_end: '12:00', capacity: 10 })
  const isAdmin = JSON.parse(localStorage.getItem('auth_user') || '{}').role === 'admin'

  const load = async () => {
    try {
      const [s, d] = await Promise.all([
        api.get('/slots', { params: filter }).then(r => r.data.list),
        api.get('/doctors').then(r => r.data.list)
      ])
      setSlots(s); setDoctors(d)
    } catch (e) { toast('加载失败', 'error') }
  }
  useEffect(() => { load() }, [filter])

  const createSlot = async () => {
    try {
      await api.post('/slots', newSlot)
      toast('号源创建成功', 'success')
      setShowNew(false); load()
    } catch (e) { toast(e.response?.data?.error || '创建失败', 'error') }
  }

  const adjustAvail = async (id, delta) => {
    try {
      await api.put(`/slots/${id}/availability`, { delta })
      toast('已调整可用数量', 'success'); load()
    } catch (e) { toast(e.response?.data?.error || '失败', 'error') }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">📅 号源管理</h2>
        <div className="flex gap-2">
          {isAdmin && <button className="btn btn-primary" onClick={() => setShowNew(true)}>➕ 新增号源</button>}
          <button onClick={load} className="btn btn-outline">🔄 刷新</button>
        </div>
      </div>

      <div className="card flex gap-3 items-center flex-wrap">
        <input type="date" className="input" value={filter.date} onChange={e => setFilter({ ...filter, date: e.target.value })} />
        <select className="input" value={filter.doctorId} onChange={e => setFilter({ ...filter, doctorId: e.target.value })}>
          <option value="">全部医生</option>
          {doctors.map(d => <option key={d.id} value={d.id}>{d.department} - {d.name}</option>)}
        </select>
        <select className="input" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">全部状态</option>
          <option value="active">开放</option>
          <option value="full">约满</option>
          <option value="closed">关闭</option>
        </select>
        <button className="btn btn-outline" onClick={() => setFilter({ date: '', doctorId: '', status: '' })}>清除筛选</button>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>日期</th><th>时段</th><th>医生</th><th>科室</th>
              <th>时间</th><th>容量</th><th>可用</th><th>候补</th>
              <th>状态</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {slots.length === 0 && <tr><td colSpan="10" className="text-gray-400 text-center py-8">暂无号源</td></tr>}
            {slots.map(s => (
              <tr key={s.id}>
                <td className="font-medium">{s.date}</td>
                <td>{periodMap[s.period]}</td>
                <td>{s.doctor_name} <span className="text-gray-400 text-xs">{s.title}</span></td>
                <td>{s.department}</td>
                <td>{s.time_start} - {s.time_end}</td>
                <td>{s.capacity}</td>
                <td>
                  <span className={s.available_count > 0 ? 'text-emerald-600 font-bold' : 'text-gray-400'}>{s.available_count}</span>
                  <span className="ml-1 text-xs">
                    <button className="text-gray-400 hover:text-rose-600 mx-0.5" onClick={() => adjustAvail(s.id, -1)}>－</button>
                    <button className="text-gray-400 hover:text-emerald-600 mx-0.5" onClick={() => adjustAvail(s.id, +1)}>＋</button>
                  </span>
                </td>
                <td>
                  <Link to={`/waitlist?slotId=${s.id}`} className="text-primary-600 hover:underline font-medium">{s.waitlist_count || 0}</Link>
                </td>
                <td><StatusBadge status={s.status} /></td>
                <td className="flex gap-1">
                  <Link to={`/slots/${s.id}`} className="btn btn-primary">查看</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[480px] space-y-3">
            <h3 className="text-lg font-bold">新增号源</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">医生</label>
                <select className="input w-full" value={newSlot.doctor_id} onChange={e => setNewSlot({ ...newSlot, doctor_id: e.target.value })}>
                  <option value="">请选择</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.department} - {d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">日期</label>
                <input type="date" className="input w-full" value={newSlot.date} onChange={e => setNewSlot({ ...newSlot, date: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">时段</label>
                <select className="input w-full" value={newSlot.period} onChange={e => setNewSlot({ ...newSlot, period: e.target.value })}>
                  <option value="morning">上午</option><option value="afternoon">下午</option><option value="evening">晚间</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">容量</label>
                <input type="number" className="input w-full" min={1} value={newSlot.capacity} onChange={e => setNewSlot({ ...newSlot, capacity: +e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">开始时间</label>
                <input type="time" className="input w-full" value={newSlot.time_start} onChange={e => setNewSlot({ ...newSlot, time_start: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">结束时间</label>
                <input type="time" className="input w-full" value={newSlot.time_end} onChange={e => setNewSlot({ ...newSlot, time_end: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <button className="btn btn-outline" onClick={() => setShowNew(false)}>取消</button>
              <button className="btn btn-primary" onClick={createSlot}>确认创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { periodMap }
