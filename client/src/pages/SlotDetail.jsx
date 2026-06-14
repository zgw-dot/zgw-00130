import { useEffect, useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import api, { toast } from '../api.js'
import { StatusBadge, NotifBadge } from './Dashboard.jsx'
import { periodMap } from './Slots.jsx'

export default function SlotDetail() {
  const { id } = useParams()
  const [slot, setSlot] = useState(null)
  const [next, setNext] = useState(null)
  const [waitlist, setWaitlist] = useState([])
  const [notifications, setNotifications] = useState([])
  const [patients, setPatients] = useState([])
  const [showAddPatient, setShowAddPatient] = useState(false)
  const [addPatientForm, setAddPatientForm] = useState({ name: '', phone: '', id_card: '' })
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [showCreatePatient, setShowCreatePatient] = useState(false)

  const load = async () => {
    try {
      const [s, w, n, p] = await Promise.all([
        api.get(`/slots/${id}`).then(r => r.data),
        api.get('/waitlist', { params: { slotId: id } }).then(r => r.data.list),
        api.get('/notifications', { params: { slotId: id } }).then(r => r.data.list),
        api.get('/patients').then(r => r.data.list)
      ])
      setSlot(s.slot); setNext(s.nextWaiter); setWaitlist(w); setNotifications(n); setPatients(p)
    } catch (e) { toast('加载失败', 'error') }
  }
  useEffect(() => { load() }, [id])

  const issueOpportunity = async (waitlistId) => {
    try {
      await api.post(`/waitlist/${waitlistId || 0}/opportunity`, { slotId: id })
      toast('已发放确认机会', 'success'); load()
    } catch (e) { toast(e.response?.data?.error || '操作失败', 'error') }
  }

  const issueNext = async () => {
    try {
      await api.post(`/waitlist/slot/${id}/issue-next`)
      toast('已向下一位发放确认机会', 'success'); load()
    } catch (e) { toast(e.response?.data?.error || '操作失败', 'error') }
  }

  const confirmWaitlist = async (waitlistId) => {
    if (!confirm('确认该候补占号？')) return
    try {
      await api.post(`/waitlist/${waitlistId}/confirm`, { slotId: id })
      toast('候补确认成功', 'success'); load()
    } catch (e) { toast(e.response?.data?.error || '操作失败', 'error') }
  }

  const passWaitlist = async (waitlistId) => {
    const reason = prompt('请输入过号原因（可选）：')
    try {
      await api.post(`/waitlist/${waitlistId}/pass`, { slotId: id, reason })
      toast('已过号处理', 'success'); load()
    } catch (e) { toast(e.response?.data?.error || '操作失败', 'error') }
  }

  const addPatientToWaitlist = async () => {
    if (!selectedPatientId) { toast('请选择患者', 'error'); return }
    try {
      await api.post('/waitlist', { slotId: id, patientId: selectedPatientId })
      toast('已加入候补队列', 'success')
      setShowAddPatient(false); setSelectedPatientId(''); load()
    } catch (e) { toast(e.response?.data?.error || '操作失败', 'error') }
  }

  const createPatientAndAdd = async () => {
    if (!addPatientForm.name || !addPatientForm.phone) { toast('姓名和电话必填', 'error'); return }
    try {
      const r = await api.post('/patients', addPatientForm)
      await api.post('/waitlist', { slotId: id, patientId: r.data.id })
      toast('已创建患者并加入候补', 'success')
      setShowCreatePatient(false); setAddPatientForm({ name: '', phone: '', id_card: '' }); load()
    } catch (e) { toast(e.response?.data?.error || '操作失败', 'error') }
  }

  const exportCsv = () => {
    window.location.href = `/api/export/waitlist/${id}`
  }

  const activeWaitlist = useMemo(() => waitlist.filter(w => ['waiting', 'notifying'].includes(w.status)), [waitlist])
  const historyWaitlist = useMemo(() => waitlist.filter(w => !['waiting', 'notifying'].includes(w.status)), [waitlist])

  if (!slot) return <div className="p-8 text-center text-gray-500">加载中...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <Link to="/slots" className="text-sm text-primary-600 hover:underline">← 返回号源列表</Link>
          <h2 className="text-2xl font-bold mt-1">{slot.doctor_name} <span className="text-gray-400 text-base font-normal">{slot.title}</span></h2>
          <div className="text-sm text-gray-600 mt-1">
            {slot.date} {periodMap[slot.period]} ({slot.time_start}-{slot.time_end}) · {slot.department} · <StatusBadge status={slot.status} />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn btn-outline">🔄 刷新</button>
          <button onClick={exportCsv} className="btn btn-success">📥 导出名单</button>
          <button onClick={() => setShowAddPatient(true)} className="btn btn-primary">➕ 加入候补</button>
          <button onClick={issueNext} className="btn btn-warning" disabled={!next}>🎁 发放下一位确认机会</button>
        </div>
      </div>

      {next && (
        <div className="card border-l-4 border-amber-400 bg-amber-50/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-amber-700 text-xs font-semibold mb-1">📣 下一位候补患者</div>
              <div className="font-bold text-lg">#{next.position} {next.patient_name}</div>
              <div className="text-sm text-gray-500">📞 {next.patient_phone} · 加入：{next.created_at}</div>
            </div>
            <button onClick={() => issueOpportunity(next.id)} className="btn btn-warning px-4 py-2">🎁 立即发放确认机会</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <div className="card"><div className="text-xs text-gray-500">总容量</div><div className="text-2xl font-bold mt-1">{slot.capacity}</div></div>
        <div className="card"><div className="text-xs text-gray-500">可用名额</div><div className={`text-2xl font-bold mt-1 ${slot.available_count > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{slot.available_count}</div></div>
        <div className="card"><div className="text-xs text-gray-500">进行中候补</div><div className="text-2xl font-bold mt-1 text-amber-600">{activeWaitlist.length}</div></div>
        <div className="card"><div className="text-xs text-gray-500">历史候补</div><div className="text-2xl font-bold mt-1 text-gray-500">{historyWaitlist.length}</div></div>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-3 text-gray-800">📋 候补队列（进行中）</h3>
        <table className="data-table">
          <thead><tr>
            <th>排名</th><th>患者</th><th>电话</th><th>加入时间</th><th>状态</th>
            <th>通知时间</th><th>确认截止</th><th>操作</th>
          </tr></thead>
          <tbody>
            {activeWaitlist.length === 0 && <tr><td colSpan="8" className="text-gray-400 text-center py-6">暂无进行中的候补</td></tr>}
            {activeWaitlist.map(w => (
              <tr key={w.id} className={w.status === 'notifying' ? 'bg-amber-50' : ''}>
                <td className="font-bold">#{w.position}</td>
                <td>{w.patient_name}</td>
                <td className="text-gray-500 text-xs">{w.patient_phone}</td>
                <td className="text-xs text-gray-500">{w.created_at}</td>
                <td><StatusBadge status={w.status} /></td>
                <td className="text-xs">{w.notified_at || '-'}</td>
                <td className="text-xs text-rose-600 font-medium">{w.notify_deadline || '-'}</td>
                <td className="flex gap-1">
                  {w.status === 'waiting' && <button onClick={() => issueOpportunity(w.id)} className="btn btn-warning">🎁 发放机会</button>}
                  {w.status === 'notifying' && (
                    <>
                      <button onClick={() => confirmWaitlist(w.id)} className="btn btn-success">✅ 确认</button>
                      <button onClick={() => passWaitlist(w.id)} className="btn btn-danger">过号</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {historyWaitlist.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3 text-gray-800">📚 候补历史</h3>
          <table className="data-table">
            <thead><tr>
              <th>排名</th><th>患者</th><th>状态</th><th>确认时间</th><th>过期时间</th><th>过号时间</th>
            </tr></thead>
            <tbody>
              {historyWaitlist.map(w => (
                <tr key={w.id}>
                  <td>#{w.position}</td>
                  <td>{w.patient_name}</td>
                  <td><StatusBadge status={w.status} /></td>
                  <td className="text-xs">{w.confirmed_at || '-'}</td>
                  <td className="text-xs">{w.expired_at || '-'}</td>
                  <td className="text-xs">{w.passed_at || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold mb-3 text-gray-800">🔔 通知日志（本号源）</h3>
        <div className="space-y-2 max-h-[300px] overflow-auto">
          {notifications.length === 0 && <div className="text-gray-400 text-center py-6 text-sm">暂无通知记录</div>}
          {notifications.map(n => (
            <div key={n.id} className="border border-gray-100 rounded p-3 flex justify-between items-start">
              <div>
                <div className="text-sm"><b>{n.patient_name}</b> <span className="text-gray-400 text-xs">{n.patient_phone}</span> <NotifBadge type={n.type} /></div>
                <div className="text-xs text-gray-600 mt-1">{n.message}</div>
              </div>
              <div className="text-xs text-gray-400 whitespace-nowrap">{n.sent_at}</div>
            </div>
          ))}
        </div>
      </div>

      {showAddPatient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[520px] space-y-4">
            <h3 className="text-lg font-bold">加入候补队列</h3>
            <div>
              <label className="block text-sm text-gray-600 mb-1">选择患者</label>
              <select className="input w-full" value={selectedPatientId} onChange={e => setSelectedPatientId(e.target.value)}>
                <option value="">请选择患者</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.name} · {p.phone}{p.id_card ? ` · ${p.id_card}` : ''}</option>)}
              </select>
            </div>
            <div className="text-sm text-gray-500 text-center border-t pt-3">
              没找到患者？
              <button className="text-primary-600 hover:underline ml-1" onClick={() => { setShowAddPatient(false); setShowCreatePatient(true) }}>创建新患者</button>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button className="btn btn-outline" onClick={() => setShowAddPatient(false)}>取消</button>
              <button className="btn btn-primary" onClick={addPatientToWaitlist}>确认加入</button>
            </div>
          </div>
        </div>
      )}

      {showCreatePatient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[480px] space-y-3">
            <h3 className="text-lg font-bold">创建新患者并加入候补</h3>
            <div><label className="block text-xs text-gray-600 mb-1">姓名 *</label>
              <input className="input w-full" value={addPatientForm.name} onChange={e => setAddPatientForm({ ...addPatientForm, name: e.target.value })} />
            </div>
            <div><label className="block text-xs text-gray-600 mb-1">电话 *</label>
              <input className="input w-full" value={addPatientForm.phone} onChange={e => setAddPatientForm({ ...addPatientForm, phone: e.target.value })} />
            </div>
            <div><label className="block text-xs text-gray-600 mb-1">身份证（可选）</label>
              <input className="input w-full" value={addPatientForm.id_card} onChange={e => setAddPatientForm({ ...addPatientForm, id_card: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <button className="btn btn-outline" onClick={() => { setShowCreatePatient(false); setShowAddPatient(true) }}>返回</button>
              <button className="btn btn-primary" onClick={createPatientAndAdd}>确认创建并加入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
