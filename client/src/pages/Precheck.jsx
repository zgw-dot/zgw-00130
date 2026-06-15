import { useState, useEffect } from 'react'
import { precheckApi, toast } from '../api.js'

const statusMap = {
  pending: { label: '待核验', color: 'bg-gray-100 text-gray-700 border-gray-300' },
  verified: { label: '核验通过', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  frozen: { label: '已冻结', color: 'bg-rose-100 text-rose-700 border-rose-300' },
  released: { label: '已放行', color: 'bg-sky-100 text-sky-700 border-sky-300' },
  force_released: { label: '强制放行', color: 'bg-amber-100 text-amber-700 border-amber-300' },
  revoked: { label: '已撤销', color: 'bg-purple-100 text-purple-700 border-purple-300' },
  cancelled: { label: '已取消', color: 'bg-slate-200 text-slate-600 border-slate-400' },
  checked_in: { label: '已签到', color: 'bg-teal-100 text-teal-700 border-teal-300' }
}

const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' }

const ruleDescriptions = {
  precheck_lab_required: '化验报告是否必填',
  precheck_imaging_required: '影像检查是否必填',
  precheck_consent_required: '知情同意书是否必填',
  precheck_fasting_required: '禁食要求确认是否必填',
  precheck_force_release_role: '允许强制放行的角色（admin/clerk）',
  precheck_auto_notify_doctor_on_release: '放行后自动通知医生',
  precheck_clerk_can_import: '办事员可按日期导入',
  precheck_clerk_can_freeze: '办事员可冻结预约',
  precheck_clerk_can_release: '办事员可放行解冻',
  precheck_clerk_can_revoke: '办事员可撤销放行'
}

function todayStr() {
  const d = new Date()
  const pad = n => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function Modal({ title, onClose, children, width = 'max-w-2xl' }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-lg shadow-xl w-full ${width} max-h-[90vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 overflow-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

export default function Precheck({ user }) {
  const [date, setDate] = useState(todayStr())
  const [statusFilter, setStatusFilter] = useState('')
  const [records, setRecords] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const [permissions, setPermissions] = useState(null)
  const [selected, setSelected] = useState(null)
  const [activeTab, setActiveTab] = useState('workbench')
  const [config, setConfig] = useState([])
  const [configLoading, setConfigLoading] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [exports, setExports] = useState([])
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [showFreezeModal, setShowFreezeModal] = useState(false)
  const [freezeReason, setFreezeReason] = useState('')
  const [showReleaseModal, setShowReleaseModal] = useState(false)
  const [releaseNote, setReleaseNote] = useState('')
  const [showRevokeModal, setShowRevokeModal] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')
  const [showImportPreview, setShowImportPreview] = useState(false)
  const [importPreview, setImportPreview] = useState([])

  useEffect(() => {
    loadPermissions()
    loadConfig()
    loadData()
    loadNotifications()
    loadExports()
  }, [])

  useEffect(() => {
    loadData()
  }, [date, statusFilter])

  const loadPermissions = async () => {
    try {
      const res = await precheckApi.getPermissions()
      setPermissions(res.data.permissions)
    } catch (e) {}
  }

  const loadConfig = async () => {
    try {
      const res = await precheckApi.getConfig()
      setConfig(res.data.config || [])
    } catch (e) {}
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const params = { date }
      if (statusFilter) params.status = statusFilter
      const [r, s] = await Promise.all([
        precheckApi.listRecords(params),
        precheckApi.getStats(date)
      ])
      setRecords(r.data.list || [])
      setStats(s.data.stats || {})
    } catch (e) {
      toast(e.response?.data?.error || '加载数据失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadNotifications = async () => {
    try {
      const res = await precheckApi.getNotifications()
      setNotifications(res.data.list || [])
    } catch (e) {}
  }

  const loadExports = async () => {
    try {
      const res = await precheckApi.listExports()
      setExports(res.data.list || [])
    } catch (e) {}
  }

  const handleImport = async () => {
    if (!permissions?.canImport) { toast('您没有导入权限', 'error'); return }
    try {
      setLoading(true)
      const res = await precheckApi.importByDate(date)
      const { imported, skipped, conflicts, batchNo, message } = res.data
      let msg = `导入完成：新增${imported}条`
      if (skipped) msg += `，跳过${skipped}条`
      if (conflicts?.length) msg += `，冲突${conflicts.length}条`
      if (message) msg = `${message}（${msg}）`
      toast(msg, imported > 0 ? 'success' : 'info')
      await loadData()
    } catch (e) {
      toast(e.response?.data?.error || '导入失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const previewImport = async () => {
    try {
      setLoading(true)
      const res = await precheckApi.getImportPreview(date)
      setImportPreview(res.data.list || [])
      setShowImportPreview(true)
    } catch (e) {
      toast(e.response?.data?.error || '预览失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const openEditModal = (rec) => {
    setSelected(rec)
    setEditForm({
      labResult: !!rec.lab_result,
      labNote: rec.lab_note || '',
      imagingResult: !!rec.imaging_result,
      imagingNote: rec.imaging_note || '',
      consentResult: !!rec.consent_result,
      consentNote: rec.consent_note || '',
      fastingResult: !!rec.fasting_result,
      fastingNote: rec.fasting_note || ''
    })
    setShowEditModal(true)
  }

  const submitEdit = async () => {
    if (!selected) return
    if (['cancelled', 'checked_in'].includes(selected.status)) {
      toast('当前状态不允许修改核验项', 'error')
      return
    }
    try {
      setLoading(true)
      const res = await precheckApi.updateCheckItems(selected.id, editForm)
      const { ok, missing, record } = res.data
      if (ok) {
        toast('所有核验项已完成，状态更新为核验通过', 'success')
      } else if (missing?.length) {
        toast(`核验项已保存，仍缺少：${missing.join('、')}`, 'info')
      } else {
        toast('核验项已保存', 'success')
      }
      setShowEditModal(false)
      await loadData()
    } catch (e) {
      toast(e.response?.data?.error || '保存失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const submitFreeze = async () => {
    if (!selected) return
    if (!freezeReason.trim()) { toast('必须填写冻结原因', 'error'); return }
    try {
      setLoading(true)
      await precheckApi.freezeRecord(selected.id, freezeReason.trim())
      toast('冻结成功，已发送通知', 'success')
      setShowFreezeModal(false)
      setFreezeReason('')
      await loadData()
      await loadNotifications()
    } catch (e) {
      toast(e.response?.data?.error || '冻结失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const submitRelease = async (force = false) => {
    if (!selected) return
    try {
      setLoading(true)
      const note = releaseNote.trim() || (force ? '强制特批' : '')
      const res = await precheckApi.releaseRecord(selected.id, note, force)
      toast(force ? '强制放行成功，已通知医生和患者' : '放行成功', 'success')
      setShowReleaseModal(false)
      setReleaseNote('')
      await loadData()
      await loadNotifications()
    } catch (e) {
      toast(e.response?.data?.error || '放行失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const submitRevoke = async () => {
    if (!selected) return
    if (!revokeReason.trim()) { toast('必须填写撤销原因', 'error'); return }
    try {
      setLoading(true)
      await precheckApi.revokeRecord(selected.id, revokeReason.trim())
      toast('撤销成功，已回滚状态并通知', 'success')
      setShowRevokeModal(false)
      setRevokeReason('')
      await loadData()
      await loadNotifications()
    } catch (e) {
      toast(e.response?.data?.error || '撤销失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async (exportType = 'by_date') => {
    try {
      setLoading(true)
      const params = {}
      if (exportType !== 'all') params.date = date
      if (statusFilter) params.status = statusFilter
      const res = await precheckApi.exportCsv(params)
      const disposition = res.headers['content-disposition'] || ''
      const match = disposition.match(/filename\*?="?([^";]+)"?/)
      const filename = match ? decodeURIComponent(match[1]) : `术前核验_${date}.csv`
      downloadBlob(res.data, filename)
      toast(`导出成功，共保存记录（详情见导出历史）`, 'success')
      await loadExports()
    } catch (e) {
      toast(e.response?.data?.error || '导出失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const downloadTemplate = async () => {
    try {
      const res = await precheckApi.getTemplate()
      downloadBlob(res.data, '术前核验导入模板.csv')
      toast('模板下载成功', 'success')
    } catch (e) {
      toast('模板下载失败', 'error')
    }
  }

  const updateRule = async (key, rawValue) => {
    if (user.role !== 'admin') { toast('仅管理员可修改规则', 'error'); return }
    try {
      setConfigLoading(true)
      let value = rawValue
      if (typeof rawValue === 'boolean') value = rawValue ? 'true' : 'false'
      await precheckApi.updateConfig(key, value)
      toast('规则已更新', 'success')
      await loadConfig()
      await loadPermissions()
    } catch (e) {
      toast(e.response?.data?.error || '更新失败', 'error')
    } finally {
      setConfigLoading(false)
    }
  }

  const total = records.length
  const statusCounts = [
    { key: 'pending', label: '待核验', color: 'border-gray-400 bg-gray-50' },
    { key: 'verified', label: '核验通过', color: 'border-emerald-400 bg-emerald-50' },
    { key: 'frozen', label: '已冻结', color: 'border-rose-400 bg-rose-50' },
    { key: 'released', label: '已放行', color: 'border-sky-400 bg-sky-50' },
    { key: 'force_released', label: '强制放行', color: 'border-amber-400 bg-amber-50' },
    { key: 'revoked', label: '已撤销', color: 'border-purple-400 bg-purple-50' }
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">🏥 术前核验工作台</h2>
          <p className="text-sm text-gray-500 mt-1">按日期批量导入待处理预约，核对化验/影像/知情同意/禁食要求，冻结材料不全的记录，补齐后放行</p>
        </div>
        <div className="text-xs text-gray-500">
          {permissions && (
            <span className="inline-flex gap-2 items-center flex-wrap">
              <span className={permissions.canImport ? 'badge badge-active' : 'badge badge-warning'}>{permissions.canImport ? '可导入' : '禁止导入'}</span>
              <span className={permissions.canFreeze ? 'badge badge-active' : 'badge badge-warning'}>{permissions.canFreeze ? '可冻结' : '禁止冻结'}</span>
              <span className={permissions.canRelease ? 'badge badge-active' : 'badge badge-warning'}>{permissions.canRelease ? '可放行' : '禁止放行'}</span>
              <span className={permissions.canForceRelease ? 'badge badge-active' : 'badge badge-warning'}>{permissions.canForceRelease ? '可强放' : '禁止强放'}</span>
              <span className={permissions.canRevoke ? 'badge badge-active' : 'badge badge-warning'}>{permissions.canRevoke ? '可撤销' : '禁止撤销'}</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b">
        {[
          { key: 'workbench', label: '📋 核验工作台', roles: ['admin', 'clerk'] },
          { key: 'rules', label: '⚙️ 规则配置', roles: ['admin', 'clerk'] },
          { key: 'notifications', label: '🔔 通知记录', roles: ['admin', 'clerk'] },
          { key: 'exports', label: '📤 导出历史', roles: ['admin', 'clerk'] }
        ].filter(t => t.roles.includes(user.role)).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${activeTab === t.key ? 'border-primary-600 text-primary-700 font-semibold' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >{t.label}</button>
        ))}
      </div>

      {activeTab === 'workbench' && (
        <>
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">核验日期</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input w-auto" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">状态筛选</label>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto">
                  <option value="">全部状态</option>
                  {Object.entries(statusMap).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1" />
              <button onClick={previewImport} className="btn btn-outline">👁️ 预览该日期预约</button>
              <button onClick={handleImport} disabled={loading || !permissions?.canImport} className="btn btn-primary">📥 按日期导入待核验</button>
              <button onClick={() => handleExport('by_date')} className="btn btn-success">📤 导出当前筛选</button>
              <button onClick={() => handleExport('all')} className="btn btn-outline">📤 导出全部</button>
              <button onClick={downloadTemplate} className="btn btn-outline">📄 下载模板</button>
              <button onClick={loadData} disabled={loading} className="btn btn-outline">🔄 刷新</button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
            <div className={`card p-4 border-l-4 border-gray-500`}>
              <div className="text-xs text-gray-500">合计</div>
              <div className="text-2xl font-bold">{total}</div>
            </div>
            {statusCounts.map(s => (
              <div key={s.key} className={`card p-4 border-l-4 ${s.color}`}>
                <div className="text-xs text-gray-500">{s.label}</div>
                <div className="text-2xl font-bold">{stats[s.key] || 0}</div>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            {loading && <div className="p-8 text-center text-gray-500">加载中...</div>}
            {!loading && records.length === 0 && (
              <div className="p-12 text-center text-gray-500">
                <div className="text-4xl mb-3">📭</div>
                <div>当前日期没有核验记录，点击「按日期导入待核验」从预约中拉取</div>
              </div>
            )}
            {!loading && records.length > 0 && (
              <div className="overflow-auto max-h-[60vh]">
                <table className="data-table">
                  <thead className="sticky top-0 bg-white shadow-sm z-10">
                    <tr>
                      <th>日期/时段</th>
                      <th>患者</th>
                      <th>医生/科室</th>
                      <th>状态</th>
                      <th>化验</th>
                      <th>影像</th>
                      <th>知情同意</th>
                      <th>禁食</th>
                      <th>冻结/放行原因</th>
                      <th className="text-right sticky right-0 bg-white shadow-[_-2px_0_5px_-2px_rgba(0,0,0,0.1)]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(r => {
                      const sm = statusMap[r.status] || statusMap.pending
                      const readonly = ['cancelled', 'checked_in', 'revoked'].includes(r.status)
                      return (
                        <tr key={r.id} className={`${r.status === 'frozen' ? 'bg-rose-50/60' : ''} ${r.status === 'force_released' ? 'bg-amber-50/60' : ''}`}>
                          <td>
                            <div className="font-medium">{r.check_date}</div>
                            <div className="text-xs text-gray-500">{periodMap[r.period] || r.period} {r.time_start}</div>
                          </td>
                          <td>
                            <div className="font-medium">{r.patient_name}</div>
                            <div className="text-xs text-gray-500">{r.patient_phone} {r.id_card ? `·${r.id_card.slice(-4)}` : ''}</div>
                          </td>
                          <td>
                            <div>{r.doctor_name}</div>
                            <div className="text-xs text-gray-500">{r.department}</div>
                          </td>
                          <td>
                            <span className={`badge inline-block border ${sm.color}`}>{sm.label}</span>
                          </td>
                          <CheckCell ok={r.lab_result} note={r.lab_note} requiredKey="precheck_lab_required" config={config} />
                          <CheckCell ok={r.imaging_result} note={r.imaging_note} requiredKey="precheck_imaging_required" config={config} />
                          <CheckCell ok={r.consent_result} note={r.consent_note} requiredKey="precheck_consent_required" config={config} />
                          <CheckCell ok={r.fasting_result} note={r.fasting_note} requiredKey="precheck_fasting_required" config={config} />
                          <td className="text-xs max-w-[180px]">
                            {r.freeze_reason && <div className="text-rose-700">冻：{r.freeze_reason}</div>}
                            {r.release_note && <div className="text-sky-700">放：{r.release_note}</div>}
                            {r.revoke_reason && <div className="text-purple-700">撤：{r.revoke_reason}</div>}
                          </td>
                          <td className="text-right whitespace-nowrap sticky right-0 bg-inherit shadow-[_-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                            {!readonly && (
                              <button onClick={() => openEditModal(r)} className="btn btn-outline btn-xs mr-1">编辑核验</button>
                            )}
                            {['pending', 'verified'].includes(r.status) && permissions?.canFreeze && (
                              <button onClick={() => { setSelected(r); setFreezeReason(''); setShowFreezeModal(true) }} className="btn btn-rose btn-xs mr-1">冻结</button>
                            )}
                            {r.status === 'frozen' && permissions?.canRelease && (
                              <button onClick={() => { setSelected(r); setReleaseNote(''); setShowReleaseModal(true) }} className="btn btn-sky btn-xs mr-1">放行</button>
                            )}
                            {r.status === 'frozen' && permissions?.canForceRelease && (
                              <button onClick={() => { setSelected(r); setReleaseNote(''); if (confirm('确定强制放行？将绕过所有未完成的核验项')) submitRelease(true) }} className="btn btn-amber btn-xs mr-1">强放</button>
                            )}
                            {['released', 'force_released'].includes(r.status) && permissions?.canRevoke && (
                              <button onClick={() => { setSelected(r); setRevokeReason(''); setShowRevokeModal(true) }} className="btn btn-purple btn-xs">撤销</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'rules' && (
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">术前核验规则配置</h3>
            {user.role !== 'admin' && <span className="badge badge-warning">仅管理员可修改（只读）</span>}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {config.map(c => {
              const isBool = c.value === 'true' || c.value === 'false'
              const isRole = c.key === 'precheck_force_release_role'
              return (
                <div key={c.key} className="border rounded p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-medium text-gray-800">{ruleDescriptions[c.key] || c.key}</div>
                      <div className="text-xs text-gray-400 mt-1 font-mono">{c.key}</div>
                    </div>
                    <div className="text-right">
                      {isBool ? (
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={c.value === 'true'}
                            disabled={user.role !== 'admin' || configLoading}
                            onChange={e => updateRule(c.key, e.target.checked)}
                            className="w-4 h-4"
                          />
                          <span className={`text-sm ${c.value === 'true' ? 'text-emerald-600 font-semibold' : 'text-gray-500'}`}>
                            {c.value === 'true' ? '启用' : '停用'}
                          </span>
                        </label>
                      ) : isRole ? (
                        <select
                          value={c.value}
                          disabled={user.role !== 'admin' || configLoading}
                          onChange={e => updateRule(c.key, e.target.value)}
                          className="input w-auto text-sm"
                        >
                          <option value="admin">仅管理员</option>
                          <option value="clerk">管理员+办事员</option>
                        </select>
                      ) : (
                        <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">{c.value}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {c.updated_by_name && <span>最近修改：{c.updated_by_name}</span>}
                    {c.updated_at && <span className="ml-2">@{c.updated_at}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="card">
          <div className="mb-4">
            <h3 className="font-semibold">核验通知记录（冻结/放行/强制放行/撤销/医生通知）</h3>
          </div>
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无通知记录</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>时间</th><th>类型</th><th>接收角色</th><th>患者</th><th>内容</th><th>发送人</th></tr>
              </thead>
              <tbody>
                {notifications.map(n => (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap text-xs text-gray-500">{n.created_at}</td>
                    <td>
                      <span className={`badge ${
                        n.notification_type === 'frozen' ? 'bg-rose-100 text-rose-700' :
                        n.notification_type === 'released' ? 'bg-sky-100 text-sky-700' :
                        n.notification_type === 'force_released' ? 'bg-amber-100 text-amber-700' :
                        n.notification_type === 'revoked' ? 'bg-purple-100 text-purple-700' :
                        'bg-teal-100 text-teal-700'
                      }`}>
                        {{frozen:'冻结',released:'放行',force_released:'强放',revoked:'撤销',doctor_notify:'医生通知'}[n.notification_type] || n.notification_type}
                      </span>
                    </td>
                    <td className="text-sm">
                      {{patient:'患者',doctor:'医生',clerk:'办事员',admin:'管理员'}[n.recipient_role] || n.recipient_role}
                    </td>
                    <td className="text-sm"><b>{n.patient_name}</b><span className="text-xs text-gray-500 ml-1">{n.phone}</span></td>
                    <td className="text-xs text-gray-600 max-w-md">{n.content}</td>
                    <td className="text-xs text-gray-500">{n.sent ? '已发送' : '待发'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'exports' && (
        <div className="card">
          <div className="mb-4">
            <h3 className="font-semibold">导出历史（每次导出都带快照哈希，用于对账一致性）</h3>
          </div>
          {exports.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无导出记录</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>时间</th><th>类型</th><th>日期过滤</th><th>记录数</th><th>文件名</th><th>快照哈希</th><th>操作人</th></tr>
              </thead>
              <tbody>
                {exports.map(e => (
                  <tr key={e.id}>
                    <td className="text-xs text-gray-500">{e.created_at}</td>
                    <td><span className="badge badge-active">{{all:'全量',by_date:'按日期',frozen:'冻结',verified:'通过'}[e.export_type] || e.export_type}</span></td>
                    <td className="text-sm">{e.date_filter || '无'}</td>
                    <td className="text-sm font-semibold">{e.record_count}</td>
                    <td className="text-xs font-mono">{e.file_name}</td>
                    <td className="text-xs font-mono text-gray-500">{e.snapshot_hash ? e.snapshot_hash.slice(0, 12) + '...' : '-'}</td>
                    <td className="text-sm">{e.created_by_name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showEditModal && selected && (
        <Modal title={`编辑核验项 - ${selected.patient_name}`}>
          <div className="space-y-4">
            <div className="bg-gray-50 border rounded p-3 text-sm">
              <div>日期：<b>{selected.check_date}</b> {periodMap[selected.period]} {selected.time_start}</div>
              <div>医生：<b>{selected.doctor_name}</b>（{selected.department}）</div>
              <div>当前状态：<span className={`badge border ${statusMap[selected.status]?.color}`}>{statusMap[selected.status]?.label}</span></div>
            </div>

            <CheckEdit label="化验报告" requiredKey="precheck_lab_required" resultKey="labResult" noteKey="labNote" form={editForm} setForm={setEditForm} config={config} />
            <CheckEdit label="影像检查" requiredKey="precheck_imaging_required" resultKey="imagingResult" noteKey="imagingNote" form={editForm} setForm={setEditForm} config={config} />
            <CheckEdit label="知情同意书" requiredKey="precheck_consent_required" resultKey="consentResult" noteKey="consentNote" form={editForm} setForm={setEditForm} config={config} />
            <CheckEdit label="禁食要求确认" requiredKey="precheck_fasting_required" resultKey="fastingResult" noteKey="fastingNote" form={editForm} setForm={setEditForm} config={config} />

            <div className="flex gap-2 justify-end pt-4 border-t">
              <button onClick={() => setShowEditModal(false)} className="btn btn-outline">取消</button>
              <button onClick={submitEdit} disabled={loading} className="btn btn-primary">保存核验项</button>
            </div>
          </div>
        </Modal>
      )}

      {showFreezeModal && selected && (
        <Modal title={`冻结预约 - ${selected.patient_name}`} width="max-w-lg">
          <div className="space-y-3">
            <div className="bg-rose-50 border border-rose-200 rounded p-3 text-sm text-rose-700">
              冻结后该预约将无法执行，必须补齐材料后解冻放行。患者会收到冻结通知。
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">冻结原因 <span className="text-rose-500">*</span></label>
              <textarea
                value={freezeReason}
                onChange={e => setFreezeReason(e.target.value)}
                rows={3}
                className="input w-full"
                placeholder="请详细说明缺少哪些材料或存在何种问题（必须填写，不允许空原因）"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowFreezeModal(false)} className="btn btn-outline">取消</button>
              <button onClick={submitFreeze} disabled={loading || !freezeReason.trim()} className="btn btn-rose">确认冻结</button>
            </div>
          </div>
        </Modal>
      )}

      {showReleaseModal && selected && (
        <Modal title={`放行解冻 - ${selected.patient_name}`} width="max-w-lg">
          <div className="space-y-3">
            <div className="bg-sky-50 border border-sky-200 rounded p-3 text-sm text-sky-700">
              普通放行需要所有必填核验项全部完成。强制放行由管理员特批，可绕过核验项。放行后根据配置会自动通知医生。
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">放行说明（可选，强制放行必填）</label>
              <textarea
                value={releaseNote}
                onChange={e => setReleaseNote(e.target.value)}
                rows={2}
                className="input w-full"
                placeholder="说明补齐了哪些材料 / 特批理由"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowReleaseModal(false)} className="btn btn-outline">取消</button>
              <button onClick={() => submitRelease(false)} disabled={loading} className="btn btn-sky">普通放行</button>
              {permissions?.canForceRelease && (
                <button onClick={() => submitRelease(true)} disabled={loading} className="btn btn-amber">强制放行（特批）</button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {showRevokeModal && selected && (
        <Modal title={`撤销放行（回滚）- ${selected.patient_name}`} width="max-w-lg">
          <div className="space-y-3">
            <div className="bg-purple-50 border border-purple-200 rounded p-3 text-sm text-purple-700">
              撤销会把「已放行/强制放行」的记录回滚到「已撤销」状态。需要填写原因，全程留痕。
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">撤销原因 <span className="text-rose-500">*</span></label>
              <textarea
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                rows={3}
                className="input w-full"
                placeholder="请填写撤销放行的原因（操作错误、材料仍缺失等）"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowRevokeModal(false)} className="btn btn-outline">取消</button>
              <button onClick={submitRevoke} disabled={loading || !revokeReason.trim()} className="btn btn-purple">确认撤销</button>
            </div>
          </div>
        </Modal>
      )}

      {showImportPreview && (
        <Modal title={`${date} 待导入预约预览（${importPreview.length}条）`}>
          {importPreview.length === 0 ? (
            <div className="p-12 text-center text-gray-500">该日期没有待处理的预约</div>
          ) : (
            <div className="overflow-auto max-h-[60vh]">
              <table className="data-table">
                <thead className="sticky top-0 bg-white">
                  <tr><th>时段</th><th>患者</th><th>医生</th><th>科室</th><th>预约状态</th></tr>
                </thead>
                <tbody>
                  {importPreview.map(a => (
                    <tr key={a.id}>
                      <td className="text-sm">{periodMap[a.period]} {a.time_start}-{a.time_end}</td>
                      <td className="text-sm"><b>{a.patient_name}</b> <span className="text-gray-500 text-xs">{a.phone}</span></td>
                      <td className="text-sm">{a.doctor_name}</td>
                      <td className="text-sm text-gray-500">{a.department}</td>
                      <td><span className="badge badge-active">{{booked:'已预约',confirmed:'已确认'}[a.status]||a.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-4 border-t mt-4">
            <button onClick={() => setShowImportPreview(false)} className="btn btn-outline">关闭</button>
            <button onClick={() => { setShowImportPreview(false); handleImport() }} disabled={!permissions?.canImport} className="btn btn-primary">确认导入</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function CheckCell({ ok, note, requiredKey, config }) {
  const cfg = config?.find(c => c.key === requiredKey)
  const isRequired = cfg?.value === 'true'
  return (
    <td>
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : isRequired ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
        <span>{ok ? '✓' : '✗'}</span>
        <span>{ok ? '完成' : '未完成'}</span>
        {isRequired && !ok && <span className="text-rose-500 font-bold">*</span>}
      </div>
      {note && <div className="text-xs text-gray-500 mt-1 max-w-[120px] truncate" title={note}>{note}</div>}
    </td>
  )
}

function CheckEdit({ label, requiredKey, resultKey, noteKey, form, setForm, config }) {
  const update = (patch) => setForm({ ...form, ...patch })
  const cfg = config?.find(c => c.key === requiredKey)
  const isRequired = cfg?.value === 'true'
  return (
    <div className={`border rounded p-3 ${isRequired ? 'border-rose-200 bg-rose-50/30' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!form[resultKey]}
              onChange={e => update({ [resultKey]: e.target.checked })}
              className="w-4 h-4"
            />
            <span className={`font-medium ${form[resultKey] ? 'text-emerald-700' : 'text-gray-700'}`}>
              {label}
              {isRequired && <span className="text-rose-500 ml-1">*</span>}
            </span>
          </label>
          {isRequired && <span className="text-xs badge badge-warning">必填</span>}
        </div>
        <span className={`text-xs ${form[resultKey] ? 'text-emerald-600' : 'text-rose-500'}`}>
          {form[resultKey] ? '已完成' : '待完成'}
        </span>
      </div>
      <input
        type="text"
        value={form[noteKey] || ''}
        onChange={e => update({ [noteKey]: e.target.value })}
        className="input w-full text-sm"
        placeholder="备注信息（报告编号、检查结果、签署情况等）"
      />
    </div>
  )
}
