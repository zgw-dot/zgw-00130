import { useEffect, useState } from 'react'
import api, { toast } from '../api.js'
import { NotifBadge, StatusBadge } from './Dashboard.jsx'
import { periodMap } from './Slots.jsx'
import { Link } from 'react-router-dom'

export default function Notifications() {
  const [list, setList] = useState([])
  const [filter, setFilter] = useState({ slotId: '', type: '' })
  const [total, setTotal] = useState(0)

  const load = async () => {
    try {
      const r = await api.get('/notifications', { params: filter })
      setList(r.data.list); setTotal(r.data.total)
    } catch (e) { toast('加载失败', 'error') }
  }
  useEffect(() => { load() }, [filter])

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">🔔 通知日志 <span className="text-sm font-normal text-gray-500 ml-2">共 {total} 条</span></h2>
        <button onClick={load} className="btn btn-outline">🔄 刷新</button>
      </div>
      <div className="card flex gap-3 items-center flex-wrap">
        <select className="input" value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}>
          <option value="">全部类型</option>
          <option value="opportunity">确认机会</option>
          <option value="confirmed">确认成功</option>
          <option value="passed">过号通知</option>
          <option value="expired">过期通知</option>
          <option value="recovered">恢复通知</option>
          <option value="manual">手动通知</option>
        </select>
      </div>
      <div className="card">
        <table className="data-table">
          <thead><tr>
            <th>时间</th><th>类型</th><th>患者</th><th>电话</th>
            <th>号源</th><th>消息内容</th><th>状态</th>
          </tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan="7" className="text-gray-400 text-center py-10">暂无通知记录</td></tr>}
            {list.map(n => (
              <tr key={n.id}>
                <td className="text-xs">{n.sent_at}</td>
                <td><NotifBadge type={n.type} /></td>
                <td>{n.patient_name}</td>
                <td className="text-gray-500 text-xs">{n.patient_phone}</td>
                <td><Link to={`/slots/${n.slot_id}`} className="text-primary-600 hover:underline text-sm">{n.doctor_name}<br /><span className="text-xs text-gray-400">{n.date} {periodMap[n.period]}</span></Link></td>
                <td className="text-xs text-gray-600 max-w-md truncate">{n.message}</td>
                <td><span className={`badge ${n.status === 'sent' ? 'badge-confirmed' : n.status === 'failed' ? 'badge-expired' : 'badge-waiting'}`}>{n.status === 'sent' ? '已发送' : n.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function Patients() {
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', id_card: '' })

  const load = async () => {
    try { const r = await api.get('/patients', { params: { q } }); setList(r.data.list) } catch (e) { toast('加载失败', 'error') }
  }
  useEffect(() => { load() }, [q])

  const create = async () => {
    try {
      await api.post('/patients', form)
      toast('创建成功', 'success'); setShowNew(false); setForm({ name: '', phone: '', id_card: '' }); load()
    } catch (e) { toast(e.response?.data?.error || '创建失败', 'error') }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">👤 患者管理</h2>
        <div className="flex gap-2">
          <input placeholder="搜索姓名/电话/身份证..." className="input" value={q} onChange={e => setQ(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>➕ 新增患者</button>
          <button onClick={load} className="btn btn-outline">🔄 刷新</button>
        </div>
      </div>
      <div className="card">
        <table className="data-table">
          <thead><tr><th>ID</th><th>姓名</th><th>电话</th><th>身份证</th><th>创建时间</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan="5" className="text-gray-400 text-center py-10">暂无患者</td></tr>}
            {list.map(p => (
              <tr key={p.id}>
                <td>#{p.id}</td><td className="font-medium">{p.name}</td>
                <td>{p.phone}</td><td className="text-gray-500 text-xs">{p.id_card || '-'}</td>
                <td className="text-xs text-gray-500">{p.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[420px] space-y-3">
            <h3 className="text-lg font-bold">新增患者</h3>
            <div><label className="block text-xs text-gray-600 mb-1">姓名 *</label><input className="input w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">电话 *</label><input className="input w-full" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">身份证号</label><input className="input w-full" value={form.id_card} onChange={e => setForm({ ...form, id_card: e.target.value })} /></div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <button className="btn btn-outline" onClick={() => setShowNew(false)}>取消</button>
              <button className="btn btn-primary" onClick={create}>确认创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function Appointments() {
  const [list, setList] = useState([])
  const [filter, setFilter] = useState({ slotId: '', status: '' })

  const load = async () => {
    try { const r = await api.get('/appointments', { params: filter }); setList(r.data.list) } catch (e) { toast('加载失败', 'error') }
  }
  useEffect(() => { load() }, [filter])

  const releaseNoShow = async (apptId) => {
    const reason = prompt('请输入爽约原因（可选）：', '患者未到')
    try {
      const r = await api.post(`/appointments/${apptId}/release-noshow`, { reason })
      toast(r.data.nextIssued ? `已释放号源并向下一位 ${r.data.nextIssued.patientName} 发放确认机会` : '已释放号源', 'success')
      load()
    } catch (e) { toast(e.response?.data?.error || '失败', 'error') }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">🩺 预约管理</h2>
        <button onClick={load} className="btn btn-outline">🔄 刷新</button>
      </div>
      <div className="card flex gap-3 items-center flex-wrap">
        <select className="input" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">全部状态</option>
          <option value="booked">已预约</option>
          <option value="confirmed">已确认</option>
          <option value="cancelled">已取消</option>
          <option value="no_show">爽约</option>
          <option value="completed">已完成</option>
        </select>
      </div>
      <div className="card">
        <table className="data-table">
          <thead><tr>
            <th>号源</th><th>患者</th><th>电话</th><th>状态</th>
            <th>预约时间</th><th>更新时间</th><th>操作</th>
          </tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan="7" className="text-gray-400 text-center py-10">暂无预约</td></tr>}
            {list.map(a => (
              <tr key={a.id}>
                <td><Link to={`/slots/${a.slot_id}`} className="text-primary-600 hover:underline text-sm">{a.doctor_name}<br /><span className="text-xs text-gray-400">{a.date} {periodMap[a.period]} {a.time_start}</span></Link></td>
                <td className="font-medium">{a.patient_name}</td>
                <td>{a.phone}</td>
                <td><StatusBadge status={a.status} /></td>
                <td className="text-xs">{a.created_at}</td>
                <td className="text-xs">{a.updated_at}</td>
                <td>
                  {['booked', 'confirmed'].includes(a.status) && (
                    <button onClick={() => releaseNoShow(a.id)} className="btn btn-danger">⚠️ 标记爽约并释放</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function NoShowRecords() {
  const [list, setList] = useState([])
  const [recovered, setRecovered] = useState('')
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}')

  const load = async () => {
    try { const r = await api.get('/no-show-records', { params: { recovered } }); setList(r.data.list) } catch (e) { toast('加载失败', 'error') }
  }
  useEffect(() => { load() }, [recovered])

  const recover = async (id) => {
    const reason = prompt('请输入恢复原因：', '患者后续到达 / 情况说明')
    if (reason === null) return
    const trimmed = reason.trim()
    if (!trimmed) {
      toast('恢复原因不能为空', 'error')
      return
    }
    try {
      await api.post(`/no-show-records/${id}/recover`, { reason: trimmed })
      toast('已恢复爽约记录', 'success'); load()
    } catch (e) { toast(e.response?.data?.error || '失败', 'error') }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">⚠️ 爽约 / 恢复记录</h2>
        <div className="flex gap-2">
          <select className="input" value={recovered} onChange={e => setRecovered(e.target.value)}>
            <option value="">全部</option>
            <option value="false">未恢复</option>
            <option value="true">已恢复</option>
          </select>
          <button onClick={load} className="btn btn-outline">🔄 刷新</button>
        </div>
      </div>
      <div className="card">
        <table className="data-table">
          <thead><tr>
            <th>号源</th><th>患者</th><th>电话</th><th>爽约原因</th>
            <th>创建时间</th><th>恢复状态</th><th>恢复原因</th><th>操作人</th><th>操作</th>
          </tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan="9" className="text-gray-400 text-center py-10">暂无爽约记录</td></tr>}
            {list.map(r => (
              <tr key={r.id}>
                <td><Link to={`/slots/${r.slot_id}`} className="text-primary-600 hover:underline text-sm">{r.doctor_name}<br /><span className="text-xs text-gray-400">{r.date} {periodMap[r.period]}</span></Link></td>
                <td>{r.patient_name}</td>
                <td className="text-xs">{r.phone}</td>
                <td className="text-xs">{r.reason || '-'}</td>
                <td className="text-xs">{r.created_at}</td>
                <td>{r.recovered_at ? <span className="badge badge-active">已恢复</span> : <span className="badge badge-expired">未恢复</span>}</td>
                <td className="text-xs">{r.recovery_reason || '-'}</td>
                <td className="text-xs">{r.recovered_by_name || '-'}</td>
                <td>
                  {!r.recovered_at && <button onClick={() => recover(r.id)} className="btn btn-success">↩️ 恢复</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
