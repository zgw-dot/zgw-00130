import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import api, { toast } from '../api.js'
import { StatusBadge } from './Dashboard.jsx'
import { periodMap } from './Slots.jsx'

export default function Waitlist() {
  const [sp] = useSearchParams()
  const [list, setList] = useState([])
  const [filter, setFilter] = useState({ slotId: sp.get('slotId') || '', status: 'active', patientId: '' })
  const [patients, setPatients] = useState([])
  const [slots, setSlots] = useState([])

  const load = async () => {
    try {
      const [l, p, s] = await Promise.all([
        api.get('/waitlist', { params: filter }).then(r => r.data.list),
        api.get('/patients').then(r => r.data.list),
        api.get('/slots').then(r => r.data.list)
      ])
      setList(l); setPatients(p); setSlots(s)
    } catch (e) { toast('加载失败', 'error') }
  }
  useEffect(() => { load() }, [filter])

  const issueOpportunity = async (waitlistId, slotId) => {
    try { await api.post(`/waitlist/${waitlistId}/opportunity`, { slotId }); toast('已发放确认机会', 'success'); load() }
    catch (e) { toast(e.response?.data?.error || '失败', 'error') }
  }
  const confirmWaitlist = async (waitlistId, slotId) => {
    if (!confirm('确认占号？')) return
    try { await api.post(`/waitlist/${waitlistId}/confirm`, { slotId }); toast('确认成功', 'success'); load() }
    catch (e) { toast(e.response?.data?.error || '失败', 'error') }
  }
  const passWaitlist = async (waitlistId, slotId) => {
    const reason = prompt('请输入过号原因：')
    try { await api.post(`/waitlist/${waitlistId}/pass`, { slotId, reason }); toast('已过号', 'success'); load() }
    catch (e) { toast(e.response?.data?.error || '失败', 'error') }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">📋 候补队列</h2>
        <button onClick={load} className="btn btn-outline">🔄 刷新</button>
      </div>

      <div className="card flex gap-3 items-center flex-wrap">
        <select className="input" value={filter.slotId} onChange={e => setFilter({ ...filter, slotId: e.target.value })}>
          <option value="">全部号源</option>
          {slots.map(s => <option key={s.id} value={s.id}>{s.date} {periodMap[s.period]} {s.doctor_name}</option>)}
        </select>
        <select className="input" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="active">进行中（等候+待确认）</option>
          <option value="">全部状态</option>
          <option value="waiting">等候中</option>
          <option value="notifying">待确认</option>
          <option value="confirmed">已确认</option>
          <option value="passed">已过号</option>
          <option value="expired">已过期</option>
          <option value="cancelled">已取消</option>
        </select>
        <select className="input" value={filter.patientId} onChange={e => setFilter({ ...filter, patientId: e.target.value })}>
          <option value="">全部患者</option>
          {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="card">
        <table className="data-table">
          <thead><tr>
            <th>排名</th><th>号源</th><th>患者</th><th>电话</th>
            <th>状态</th><th>加入时间</th><th>通知/截止</th><th>操作</th>
          </tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan="8" className="text-gray-400 text-center py-10">暂无候补记录</td></tr>}
            {list.map(w => (
              <tr key={w.id} className={w.status === 'notifying' ? 'bg-amber-50' : ''}>
                <td className="font-bold">#{w.position}</td>
                <td><Link to={`/slots/${w.slot_id}`} className="text-primary-600 hover:underline">{w.doctor_name}<br /><span className="text-xs text-gray-400">{w.date} {periodMap[w.period]}</span></Link></td>
                <td>{w.patient_name}</td>
                <td className="text-gray-500 text-xs">{w.patient_phone}</td>
                <td><StatusBadge status={w.status} /></td>
                <td className="text-xs">{w.created_at}</td>
                <td className="text-xs">
                  {w.notified_at ? <div>通知：{w.notified_at}</div> : null}
                  {w.notify_deadline ? <div className="text-rose-600 font-medium">截止：{w.notify_deadline}</div> : '-'}
                </td>
                <td className="flex gap-1 flex-wrap">
                  {w.status === 'waiting' && <button onClick={() => issueOpportunity(w.id, w.slot_id)} className="btn btn-warning">🎁 发放机会</button>}
                  {w.status === 'notifying' && (
                    <>
                      <button onClick={() => confirmWaitlist(w.id, w.slot_id)} className="btn btn-success">✅ 确认</button>
                      <button onClick={() => passWaitlist(w.id, w.slot_id)} className="btn btn-danger">过号</button>
                    </>
                  )}
                  {['passed', 'expired'].includes(w.status) && <button onClick={() => issueOpportunity(w.id, w.slot_id)} className="btn btn-outline">🔁 重发机会</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
