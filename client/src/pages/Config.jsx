import { useEffect, useState } from 'react'
import api, { toast } from '../api.js'

const meta = {
  waitlist_timeout_seconds: { label: '候补确认超时时间', unit: '秒', desc: '发放确认机会后患者需在此时长内确认，超时将过期。', type: 'number' },
  recovery_strategy: { label: '恢复策略', desc: '号源释放后的自动处理策略。', options: [['auto_next', '自动通知下一位'], ['manual', '仅手动处理']] },
  auto_recover_enabled: { label: '启用自动恢复', desc: '号源释放（爽约/取消）后是否自动触发策略。', options: [['true', '启用'], ['false', '禁用']] },
  manual_trigger_enabled: { label: '允许手动触发超时', desc: '是否允许办事员手动执行“立即检查并处理过期候补”。', options: [['true', '允许'], ['false', '仅管理员']] },
  notify_retries: { label: '通知重试次数', unit: '次', type: 'number', desc: '通知发送失败时的重试次数。' },
  notify_retry_interval_seconds: { label: '通知重试间隔', unit: '秒', type: 'number', desc: '通知重试之间的等待时间。' },
  clerk_can_modify_global_config: { label: '办事员可修改全局配置', desc: '是否允许 clerk 角色修改全局配置（包括此项本身）。默认关闭。', options: [['true', '允许（危险）'], ['false', '仅管理员']] },
  position_display_mode: { label: '位置展示模式', desc: '候补位置的展示方式。', options: [['absolute', '绝对位置'], ['relative', '相对位置']] },
  export_include_contact_info: { label: '导出包含联系方式', desc: '导出候补名单 CSV 时是否包含电话和身份证号。', options: [['true', '包含'], ['false', '仅姓名']] }
}

export default function Config() {
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
  const [config, setConfig] = useState({})
  const [draft, setDraft] = useState({})
  const [loading, setLoading] = useState(false)

  const load = async () => {
    try {
      const r = await api.get('/config')
      const c = r.data.config
      setConfig(c)
      const d = {}
      Object.entries(c).forEach(([k, v]) => { d[k] = v.value })
      setDraft(d)
    } catch (e) { toast('加载失败', 'error') }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!confirm('确认修改全局配置？')) return
    setLoading(true)
    try {
      await api.put('/config', draft)
      toast('配置已更新', 'success'); load()
    } catch (e) { toast(e.response?.data?.error || '保存失败（可能是权限不足）', 'error') }
    finally { setLoading(false) }
  }

  const canEdit = user.role === 'admin' || draft.clerk_can_modify_global_config === 'true'

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">⚙️ 系统配置</h2>
        <div className="flex gap-2 items-center">
          {!canEdit && <span className="badge badge-expired">当前账户无修改权限</span>}
          <button disabled={loading || !canEdit} onClick={save} className="btn btn-primary">💾 保存配置</button>
          <button onClick={load} className="btn btn-outline">🔄 重新加载</button>
        </div>
      </div>

      {!canEdit && (
        <div className="card border-l-4 border-rose-400 bg-rose-50/30 text-sm text-rose-800">
          ⚠️ 您是 clerk 角色，默认无修改全局配置权限。如测试“普通 clerk 修改全局规则”异常路径，请先用 admin 登录后将
          <code className="mx-1 bg-white px-1 rounded"> clerk_can_modify_global_config </code>
          设为 <code className="mx-1 bg-white px-1 rounded">true</code>，然后再用 clerk 登录尝试修改。
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {Object.entries(meta).map(([key, m]) => {
          const v = draft[key]
          const updated = config[key]?.updated_at
          const by = config[key]?.updated_by
          return (
            <div key={key} className="card">
              <div className="flex justify-between items-start">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-0.5">
                    {m.label} {m.unit && <span className="text-xs text-gray-400 font-normal">（{m.unit}）</span>}
                  </label>
                  <p className="text-xs text-gray-500 mb-2">{m.desc}</p>
                </div>
                <code className="text-xs text-gray-400 bg-gray-100 px-1 rounded">{key}</code>
              </div>
              {m.options ? (
                <select disabled={!canEdit} className="input w-full" value={v ?? ''} onChange={e => setDraft({ ...draft, [key]: e.target.value })}>
                  {m.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                </select>
              ) : (
                <input disabled={!canEdit} type={m.type || 'text'} className="input w-full" value={v ?? ''} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
              )}
              {updated && (
                <div className="text-xs text-gray-400 mt-2">上次更新：{updated}{by && ` · by ${by}`}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AuditLogs() {
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState({ entityType: '', action: '' })

  const load = async () => {
    try { const r = await api.get('/audit-logs', { params: filter }); setLogs(r.data.list) }
    catch (e) { toast(e.response?.data?.error || '加载失败（审计日志仅管理员可查看）', 'error') }
  }
  useEffect(() => { load() }, [filter])

  const fmt = (v) => {
    if (v === null || v === undefined) return '-'
    if (typeof v === 'object') return <pre className="text-xs bg-gray-50 p-2 rounded max-w-xs overflow-auto">{JSON.stringify(v, null, 2)}</pre>
    return String(v)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">📝 审计日志</h2>
        <div className="flex gap-2">
          <select className="input" value={filter.entityType} onChange={e => setFilter({ ...filter, entityType: e.target.value })}>
            <option value="">全部实体</option>
            <option>waitlist</option><option>slot</option><option>appointment</option>
            <option>config</option><option>no_show_record</option><option>patient</option>
            <option>doctor</option><option>system</option><option>auth</option>
          </select>
          <select className="input" value={filter.action} onChange={e => setFilter({ ...filter, action: e.target.value })}>
            <option value="">全部操作</option>
            <option>join_waitlist</option><option>rejoin_waitlist</option><option>issue_opportunity</option>
            <option>confirm_waitlist</option><option>pass_waitlist</option><option>expire_waitlist</option>
            <option>release_noshow</option><option>recover_noshow</option>
            <option>update_config</option><option>set_time</option><option>advance_time</option>
            <option>trigger_expire</option><option>login</option><option>export_waitlist</option>
          </select>
          <button onClick={load} className="btn btn-outline">🔄 刷新</button>
        </div>
      </div>
      <div className="card overflow-auto">
        <table className="data-table">
          <thead><tr>
            <th>时间</th><th>操作人</th><th>操作</th><th>实体</th>
            <th>号源/候补/患者ID</th><th>旧值</th><th>新值</th><th>原因</th><th>IP</th>
          </tr></thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan="9" className="text-gray-400 text-center py-10">暂无审计日志</td></tr>}
            {logs.map(l => (
              <tr key={l.id}>
                <td className="text-xs whitespace-nowrap">{l.created_at}</td>
                <td className="text-xs">{l.user_name || '系统'}</td>
                <td><span className="badge badge-waiting">{l.action}</span></td>
                <td className="text-xs">{l.entity_type} #{l.entity_id || '-'}</td>
                <td className="text-xs text-gray-500">
                  {l.slot_id && <div>S#{l.slot_id}</div>}
                  {l.waitlist_id && <div>W#{l.waitlist_id}</div>}
                  {l.patient_id && <div>P#{l.patient_id}</div>}
                  {!l.slot_id && !l.waitlist_id && !l.patient_id && '-'}
                </td>
                <td className="max-w-xs">{fmt(l.old_value)}</td>
                <td className="max-w-xs">{fmt(l.new_value)}</td>
                <td className="text-xs max-w-xs">{l.reason || '-'}</td>
                <td className="text-xs text-gray-400">{l.ip_address}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function TimeControl() {
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
  const [info, setInfo] = useState(null)
  const [manualISO, setManualISO] = useState('')
  const [speed, setSpeed] = useState(1)
  const [advSec, setAdvSec] = useState(60)
  const isAdmin = user.role === 'admin'

  const load = async () => { try { const r = await api.get('/time'); setInfo(r.data); } catch (e) { toast('加载失败', 'error') } }
  useEffect(() => { let i = setInterval(load, 1500); load(); return () => clearInterval(i) }, [])

  const setTime = async () => {
    if (!manualISO) return
    try { await api.post('/time/set', { time: manualISO, speed }); toast('时间已设置', 'success'); load() }
    catch (e) { toast(e.response?.data?.error || '失败（设置时间需管理员）', 'error') }
  }
  const setSpeedOnly = async () => {
    try { await api.post('/time/set', { speed }); toast(`速度倍率已设为 ${speed}x`, 'success'); load() }
    catch (e) { toast(e.response?.data?.error || '失败', 'error') }
  }
  const advance = async () => {
    try { const r = await api.post('/time/advance', { seconds: advSec }); toast(`已推进 ${advSec} 秒`, 'success'); load(); return r }
    catch (e) { toast(e.response?.data?.error || '失败', 'error') }
  }
  const reset = async () => {
    try { await api.post('/time/reset'); toast('已重置为真实时间', 'success'); load() }
    catch (e) { toast(e.response?.data?.error || '失败（重置需管理员）', 'error') }
  }
  const triggerExpire = async () => {
    try { const r = await api.post('/time/trigger-expire'); toast(`已触发，处理了 ${r.data.processedCount} 条过期候补`, r.data.processedCount > 0 ? 'success' : 'info'); load() }
    catch (e) { toast(e.response?.data?.error || '失败', 'error') }
  }

  const isoLocal = (d) => {
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">⏰ 时间控制 / 手动触发</h2>
        <button onClick={load} className="btn btn-outline">🔄 刷新</button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-3">📊 当前时间状态</h3>
          {info && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">模式</span>
                <span className={info.mode === 'manual' ? 'badge badge-warning' : 'badge badge-active'}>{info.mode === 'manual' ? '虚拟时间模式' : '真实时间模式'}</span>
              </div>
              <div className="flex justify-between"><span className="text-gray-500">系统当前时间</span><span className="font-mono text-lg font-bold text-primary-700">{info.currentTime}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">真实系统时间</span><span className="font-mono text-xs text-gray-400">{info.realTime}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">速度倍率</span><span>{info.override?.speed_multiplier ?? 1}x</span></div>
              <div className="flex justify-between"><span className="text-gray-500">覆盖更新于</span><span className="text-xs text-gray-400">{info.override?.updated_at || '-'}</span></div>
            </div>
          )}
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold">🎚️ 手动控制</h3>
          <div>
            <label className="block text-xs text-gray-600 mb-1">设置绝对时间（需管理员）</label>
            <div className="flex gap-2">
              <input type="datetime-local" className="input flex-1" value={manualISO} onChange={e => setManualISO(e.target.value)} />
              <button disabled={!isAdmin} onClick={setTime} className="btn btn-primary">应用</button>
            </div>
            {!isAdmin && <div className="text-xs text-rose-600 mt-1">仅管理员可设置绝对时间</div>}
            <button className="text-xs text-primary-600 hover:underline mt-1" onClick={() => setManualISO(isoLocal(new Date()))}>👉 填充为当前真实时间</button>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">速度倍率</label>
            <div className="flex gap-2 items-center">
              <input type="number" step="0.5" min="0.5" max="100000" className="input w-32" value={speed} onChange={e => setSpeed(parseFloat(e.target.value))} />
              <button onClick={setSpeedOnly} className="btn btn-outline">应用倍率</button>
              <span className="text-xs text-gray-400">同时应用到时间控制</span>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">时间推进（所有角色可用）</label>
            <div className="flex gap-2 items-center flex-wrap">
              <input type="number" className="input w-24" value={advSec} onChange={e => setAdvSec(+e.target.value)} />
              <span className="text-xs text-gray-500">秒</span>
              {[10, 30, 60, 180, 600, 3600].map(s => (
                <button key={s} className="btn btn-outline text-xs" onClick={() => setAdvSec(s)}>+{s}s</button>
              ))}
              <button onClick={advance} className="btn btn-warning">🚀 立即推进</button>
            </div>
            <p className="text-xs text-gray-500 mt-1">推进时间后会立即触发一次过期候补检查，方便测试超时场景。</p>
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <button onClick={triggerExpire} className="btn btn-danger">⏱️ 立即检查并处理过期候补</button>
            {isAdmin && <button onClick={reset} className="btn btn-gray">↩️ 重置为真实时间（管理员）</button>}
          </div>
        </div>
      </div>

      <div className="card border-l-4 border-blue-400 bg-blue-50/30">
        <h3 className="font-semibold mb-2 text-blue-900">📘 使用说明（测试超时场景推荐）</h3>
        <ol className="text-sm text-blue-900/90 list-decimal list-inside space-y-1">
          <li>发放确认机会后，如果 <code>waitlist_timeout_seconds</code> 默认 180 秒太长，
            可以先到配置页将其改为 <b>30</b> 或 <b>60</b> 秒。</li>
          <li>发放确认机会后，可直接点击 <b>🚀 立即推进 180 秒</b>（或配置时长+1秒），系统会把该候补标记为 <b>expired</b> 并生成爽约记录。</li>
          <li>也可点击 <b>⏱️ 立即检查并处理过期候补</b> 手动触发扫描，等价于后台定时任务。</li>
          <li>“确认超时后未轮到下一人”的异常场景：先把配置 <code>auto_recover_enabled</code> 改为 <b>false</b> 或 <code>recovery_strategy</code> 改为 <b>manual</b>，再推进时间触发过期，下一位就不会自动通知。</li>
          <li>“无原因恢复爽约记录”：所有角色（包括管理员）恢复爽约都必须提供真实原因，空值或纯空格都会被拒绝；后端接口也做了同样校验，无法从 API 绕过。</li>
          <li>所有操作（加入候补、发放机会、确认、过号、爽约、恢复、修改配置、时间控制、导出）都会写入审计日志，admin 可查看。</li>
        </ol>
      </div>
    </div>
  )
}
