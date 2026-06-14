import { useEffect, useState } from 'react'
import api, { toast } from '../api.js'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  const [stats, setStats] = useState({})
  const [timeInfo, setTimeInfo] = useState(null)
  const [recentWaitlist, setRecentWaitlist] = useState([])
  const [recentNotif, setRecentNotif] = useState([])

  const load = async () => {
    try {
      const [s, t, w, n] = await Promise.all([
        api.get('/slots').then(r => r.data.list),
        api.get('/time').then(r => r.data),
        api.get('/waitlist?status=active').then(r => r.data.list.slice(0, 10)),
        api.get('/notifications?limit=10').then(r => r.data.list)
      ])
      const totalCap = s.reduce((a, b) => a + b.capacity, 0)
      const totalAvail = s.reduce((a, b) => a + b.available_count, 0)
      const totalWL = s.reduce((a, b) => a + (b.waitlist_count || 0), 0)
      const totalFull = s.filter(x => x.status === 'full').length
      setStats({ totalSlots: s.length, totalCap, totalAvail, totalWL, totalFull })
      setTimeInfo(t)
      setRecentWaitlist(w)
      setRecentNotif(n)
    } catch (e) { toast('加载失败', 'error') }
  }
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i) }, [])

  const Stat = ({ label, value, color, hint }) => (
    <div className={`card border-l-4 ${color}`}>
      <div className="text-gray-500 text-xs">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">仪表盘</h2>
        <div className="text-sm text-gray-600">
          {timeInfo && (
            <span>
              {timeInfo.mode === 'manual' ? (<span className="badge badge-warning mr-2">⏰ 虚拟时间</span>) : (<span className="badge badge-active mr-2">🌐 真实时间</span>)}
              当前：<b>{timeInfo.currentTime}</b>
              {timeInfo.mode === 'manual' && <span className="text-xs text-gray-400 ml-2">真实 {timeInfo.realTime}</span>}
            </span>
          )}
          <button onClick={load} className="btn btn-outline ml-3">🔄 刷新</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="号源总数" value={stats.totalSlots || 0} color="border-blue-500" />
        <Stat label="可用名额" value={stats.totalAvail || 0} color="border-emerald-500" hint={`容量 ${stats.totalCap || 0}`} />
        <Stat label="候补人数" value={stats.totalWL || 0} color="border-amber-500" />
        <Stat label="已约满号源" value={stats.totalFull || 0} color="border-rose-500" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">🎫 候补队列（进行中）</h3>
            <Link to="/waitlist" className="text-sm text-primary-600 hover:underline">查看全部 →</Link>
          </div>
          <table className="data-table">
            <thead><tr><th>号源</th><th>患者</th><th>排名</th><th>状态</th></tr></thead>
            <tbody>
              {recentWaitlist.length === 0 && <tr><td colSpan="4" className="text-gray-400 text-center py-4">暂无候补记录</td></tr>}
              {recentWaitlist.map(w => (
                <tr key={w.id}>
                  <td><Link to={`/slots/${w.slot_id}`} className="text-primary-600 hover:underline">{w.doctor_name} {w.date}</Link></td>
                  <td>{w.patient_name} <span className="text-gray-400 text-xs">{w.patient_phone}</span></td>
                  <td>#{w.position}</td>
                  <td><StatusBadge status={w.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">🔔 通知日志（最近）</h3>
            <Link to="/notifications" className="text-sm text-primary-600 hover:underline">查看全部 →</Link>
          </div>
          <div className="space-y-2 max-h-[320px] overflow-auto">
            {recentNotif.length === 0 && <div className="text-gray-400 text-center py-6 text-sm">暂无通知记录</div>}
            {recentNotif.map(n => (
              <div key={n.id} className="border border-gray-100 rounded p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm"><b>{n.patient_name}</b> <span className="text-gray-400 text-xs">{n.patient_phone}</span></span>
                  <span className="text-xs text-gray-400">{n.sent_at}</span>
                </div>
                <div className="flex justify-between items-center">
                  <NotifBadge type={n.type} />
                  <span className="text-xs text-gray-600 ml-3 flex-1">{n.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function StatusBadge({ status }) {
  const map = {
    waiting: ['badge-waiting', '等候中'],
    notifying: ['badge-notifying', '待确认'],
    confirmed: ['badge-confirmed', '已确认'],
    passed: ['badge-passed', '已过号'],
    expired: ['badge-expired', '已过期'],
    cancelled: ['badge-cancelled', '已取消'],
    active: ['badge-active', '开放'],
    full: ['badge-full', '约满'],
    closed: ['badge-closed', '关闭'],
    booked: ['badge-waiting', '已预约'],
    no_show: ['badge-expired', '爽约']
  }
  const [cls, text] = map[status] || ['badge-cancelled', status]
  return <span className={`badge ${cls}`}>{text}</span>
}

export function NotifBadge({ type }) {
  const map = {
    opportunity: ['badge-notifying', '确认机会'],
    confirmed: ['badge-confirmed', '确认成功'],
    passed: ['badge-passed', '过号通知'],
    expired: ['badge-expired', '过期通知'],
    recovered: ['badge-active', '恢复通知'],
    manual: ['badge-cancelled', '手动通知']
  }
  const [cls, text] = map[type] || ['badge-cancelled', type]
  return <span className={`badge ${cls}`}>{text}</span>
}
