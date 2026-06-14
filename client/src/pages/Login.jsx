import { useState } from 'react'
import api, { toast } from '../api.js'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await api.post('/auth/login', { username, password })
      localStorage.setItem('auth_token', res.data.token)
      localStorage.setItem('auth_user', JSON.stringify(res.data.user))
      toast('登录成功', 'success')
      onLogin(res.data.user)
    } catch (err) {
      toast(err.response?.data?.error || '登录失败', 'error')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-900 via-primary-700 to-primary-500">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-[380px]">
        <h1 className="text-2xl font-bold text-gray-800 text-center mb-1">门诊候补系统</h1>
        <p className="text-gray-500 text-sm text-center mb-6">号源与爽约恢复管理平台</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">用户名</label>
            <input className="input w-full" value={username} onChange={e => setUsername(e.target.value)} placeholder="请输入用户名" />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">密码</label>
            <input type="password" className="input w-full" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center py-2">
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
        <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-500 space-y-1">
          <p>默认账号：</p>
          <p>🔑 管理员 admin / admin123</p>
          <p>👤 办事员 clerk1 / clerk123</p>
        </div>
      </div>
    </div>
  )
}
