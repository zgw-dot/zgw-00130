import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState, useCallback } from 'react'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Slots from './pages/Slots.jsx'
import SlotDetail from './pages/SlotDetail.jsx'
import Waitlist from './pages/Waitlist.jsx'
import Notifications, { Patients, Appointments, NoShowRecords } from './pages/Notifications.jsx'
import Config, { AuditLogs, TimeControl } from './pages/Config.jsx'
import Suspension from './pages/Suspension.jsx'

const getUser = () => {
  try { return JSON.parse(localStorage.getItem('auth_user') || 'null') } catch { return null }
}

function App() {
  const [user, setUser] = useState(getUser())
  const nav = useNavigate()
  const loc = useLocation()

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    setUser(null)
    nav('/login')
  }, [nav])

  useEffect(() => {
    if (!getUser() && !loc.pathname.startsWith('/login')) {
      nav('/login')
    }
  }, [nav, loc.pathname])

  const menuItems = [
    { to: '/', label: '仪表盘', icon: '📊', roles: ['admin', 'clerk'] },
    { to: '/suspension', label: '停诊改期', icon: '🚫', roles: ['admin', 'clerk'] },
    { to: '/slots', label: '号源管理', icon: '📅', roles: ['admin', 'clerk'] },
    { to: '/waitlist', label: '候补队列', icon: '📋', roles: ['admin', 'clerk'] },
    { to: '/appointments', label: '预约管理', icon: '🩺', roles: ['admin', 'clerk'] },
    { to: '/patients', label: '患者管理', icon: '👤', roles: ['admin', 'clerk'] },
    { to: '/notifications', label: '通知日志', icon: '🔔', roles: ['admin', 'clerk'] },
    { to: '/noshow', label: '爽约/恢复', icon: '⚠️', roles: ['admin', 'clerk'] },
    { to: '/time', label: '时间控制', icon: '⏰', roles: ['admin', 'clerk'] },
    { to: '/config', label: '系统配置', icon: '⚙️', roles: ['admin', 'clerk'] },
    { to: '/audit', label: '审计日志', icon: '📝', roles: ['admin'] }
  ]

  if (!user) {
    return <Routes><Route path="/login" element={<Login onLogin={(u) => { setUser(u); nav('/') }} />} /><Route path="*" element={<Navigate to="/login" />} /></Routes>
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-primary-900 text-white flex flex-col">
        <div className="p-4 border-b border-primary-700">
          <h1 className="text-lg font-bold">门诊候补系统</h1>
          <p className="text-xs text-primary-100 mt-1">号源与爽约恢复</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {menuItems.filter(m => m.roles.includes(user.role)).map(m => (
            <Link key={m.to} to={m.to} className="block px-3 py-2 rounded-md text-sm hover:bg-primary-700 transition">
              <span className="mr-2">{m.icon}</span>{m.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-primary-700 text-xs">
          <div className="flex items-center justify-between">
            <span>{user.username} <span className="badge bg-primary-600 text-white ml-1">{user.role === 'admin' ? '管理员' : '办事员'}</span></span>
            <button onClick={logout} className="text-primary-200 hover:text-white">退出</button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/login" element={<Navigate to="/" />} />
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/suspension" element={<Suspension user={user} />} />
          <Route path="/slots" element={<Slots user={user} />} />
          <Route path="/slots/:id" element={<SlotDetail user={user} />} />
          <Route path="/waitlist" element={<Waitlist user={user} />} />
          <Route path="/appointments" element={<Appointments user={user} />} />
          <Route path="/patients" element={<Patients user={user} />} />
          <Route path="/notifications" element={<Notifications user={user} />} />
          <Route path="/noshow" element={<NoShowRecords user={user} />} />
          <Route path="/config" element={<Config user={user} />} />
          <Route path="/audit" element={<AuditLogs user={user} />} />
          <Route path="/time" element={<TimeControl user={user} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
