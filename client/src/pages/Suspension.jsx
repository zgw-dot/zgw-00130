import { useState, useEffect, useCallback } from 'react'
import { suspensionApi, toast } from '../api.js'

const statusMap = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-800' },
  pending: { label: '待执行', color: 'bg-yellow-100 text-yellow-800' },
  executing: { label: '执行中', color: 'bg-blue-100 text-blue-800' },
  completed: { label: '已完成', color: 'bg-green-100 text-green-800' },
  revoked: { label: '已撤销', color: 'bg-red-100 text-red-800' }
}

const itemTypeMap = {
  date: { label: '日期', icon: '📅' },
  doctor: { label: '医生', icon: '👨‍⚕️' },
  room: { label: '诊室', icon: '🚪' }
}

function Suspension({ user }) {
  const [batches, setBatches] = useState([])
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [batchDetail, setBatchDetail] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [activeTab, setActiveTab] = useState('list')

  const [newBatch, setNewBatch] = useState({ title: '', reason: '', remarks: '' })
  const [items, setItems] = useState([])
  const [newItem, setNewItem] = useState({ type: 'date', value: '', description: '' })
  const [importContent, setImportContent] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importResult, setImportResult] = useState(null)

  useEffect(() => {
    loadBatches()
    loadConfig()
    loadDoctors()
  }, [])

  const loadBatches = async () => {
    try {
      const res = await suspensionApi.listBatches()
      setBatches(res.data.batches)
    } catch (e) {
      toast(e.response?.data?.error || '加载批次失败', 'error')
    }
  }

  const loadConfig = async () => {
    try {
      const res = await suspensionApi.getConfig()
      setConfig(res.data.config)
    } catch (e) {}
  }

  const loadDoctors = async () => {
    try {
      const res = await suspensionApi.getDoctors()
      setDoctors(res.data.doctors)
    } catch (e) {}
  }

  const loadBatchDetail = async (id) => {
    try {
      setLoading(true)
      const res = await suspensionApi.getBatch(id)
      setBatchDetail(res.data)
      setItems(res.data.items.map(i => ({ type: i.item_type, value: i.item_value, description: i.description })))
      setSelectedBatch(res.data.batch)
      setActiveTab('detail')
    } catch (e) {
      toast(e.response?.data?.error || '加载批次详情失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const createBatch = async () => {
    if (!newBatch.title.trim()) {
      toast('请输入批次标题', 'error')
      return
    }
    try {
      setLoading(true)
      const res = await suspensionApi.createBatch(newBatch)
      setBatches([res.data.batch, ...batches])
      setShowCreate(false)
      setNewBatch({ title: '', reason: '', remarks: '' })
      toast('批次创建成功', 'success')
      await loadBatchDetail(res.data.batch.id)
    } catch (e) {
      toast(e.response?.data?.error || '创建批次失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const addItem = () => {
    if (!newItem.value.trim()) {
      toast('请输入值', 'error')
      return
    }
    setItems([...items, { ...newItem }])
    setNewItem({ type: 'date', value: '', description: '' })
  }

  const removeItem = (idx) => {
    setItems(items.filter((_, i) => i !== idx))
  }

  const saveItems = async () => {
    if (!selectedBatch) return
    if (items.length === 0) {
      toast('请至少添加一个停诊条目', 'error')
      return
    }
    try {
      setLoading(true)
      await suspensionApi.updateItems(selectedBatch.id, items)
      toast('条目保存成功', 'success')
      await loadBatchDetail(selectedBatch.id)
    } catch (e) {
      toast(e.response?.data?.error || '保存条目失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadPreview = async () => {
    if (!selectedBatch) return
    try {
      setLoading(true)
      const res = await suspensionApi.preview(selectedBatch.id)
      setPreview(res.data)
      setActiveTab('preview')
    } catch (e) {
      toast(e.response?.data?.error || '预览失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const saveDraft = async () => {
    if (!selectedBatch) return
    if (!window.confirm('确定要保存草稿并锁定号源吗？')) return
    try {
      setLoading(true)
      const res = await suspensionApi.saveDraft(selectedBatch.id)
      toast(`草稿保存成功：${res.data.slotCount}个号源，${res.data.appointmentCount}个预约，${res.data.waitlistCount}个候补`, 'success')
      await loadBatchDetail(selectedBatch.id)
      await loadBatches()
    } catch (e) {
      toast(e.response?.data?.error || '保存草稿失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const executeBatch = async () => {
    if (!selectedBatch) return
    if (user.role !== 'admin') {
      toast('只有管理员可以执行批次', 'error')
      return
    }
    if (!window.confirm('确定要正式执行该停诊批次吗？此操作不可撤销！')) return
    try {
      setLoading(true)
      const res = await suspensionApi.execute(selectedBatch.id)
      const r = res.data.results
      toast(`执行完成：预约成功${r.appointments.success}失败${r.appointments.failed}，候补成功${r.waitlist.success}失败${r.waitlist.failed}`, 'success')
      await loadBatchDetail(selectedBatch.id)
      await loadBatches()
    } catch (e) {
      toast(e.response?.data?.error || '执行失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const revokeBatch = async () => {
    if (!selectedBatch) return
    if (user.role !== 'admin') {
      toast('只有管理员可以撤销批次', 'error')
      return
    }
    const reason = window.prompt('请输入撤销原因：')
    if (reason == null) return
    try {
      setLoading(true)
      const res = await suspensionApi.revoke(selectedBatch.id, reason)
      const s = res.data.restoreStats
      toast(`撤销完成：恢复${s.restoredAppointments}个预约，${s.restoredWaitlist}个候补，${s.restoredSlots}个号源`, 'success')
      await loadBatchDetail(selectedBatch.id)
      await loadBatches()
    } catch (e) {
      toast(e.response?.data?.error || '撤销失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!importContent.trim()) {
      toast('请输入CSV内容', 'error')
      return
    }
    try {
      setLoading(true)
      const res = await suspensionApi.importCsv(importContent)
      setImportResult(res.data)
      if (res.data.items.length > 0) {
        setItems(res.data.items)
      }
      toast(`导入完成：有效${res.data.validCount}条，错误${res.data.errorCount}条`, res.data.errorCount > 0 ? 'error' : 'success')
    } catch (e) {
      toast(e.response?.data?.error || '导入失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const downloadCsv = async (type) => {
    if (!selectedBatch) return
    try {
      setLoading(true)
      let res
      if (type === 'affected') res = await suspensionApi.exportAffected(selectedBatch.id)
      else if (type === 'results') res = await suspensionApi.exportResults(selectedBatch.id)
      else if (type === 'unprocessed') res = await suspensionApi.exportUnprocessed(selectedBatch.id)
      
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers['content-disposition']
      const match = disposition && disposition.match(/filename="(.+)"/)
      a.download = match ? match[1] : `export_${selectedBatch.batch_no}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
      toast('导出成功', 'success')
    } catch (e) {
      toast(e.response?.data?.error || '导出失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const updateConfigValue = async (key, value) => {
    if (user.role !== 'admin') {
      toast('只有管理员可以修改配置', 'error')
      return
    }
    try {
      await suspensionApi.updateConfig(key, value)
      toast('配置更新成功', 'success')
      await loadConfig()
    } catch (e) {
      toast(e.response?.data?.error || '更新配置失败', 'error')
    }
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">停诊改期工作台</h1>
          <p className="text-gray-500 text-sm mt-1">批量处理停诊影响，管理预约和候补改期</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowConfig(true)} className="btn btn-secondary">⚙️ 停诊配置</button>
          <button onClick={() => { setShowCreate(true); setSelectedBatch(null); setItems([]); setBatchDetail(null); }} className="btn btn-primary">+ 新建批次</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 border-b">
        <button className={`px-4 py-2 ${activeTab === 'list' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-500'}`} onClick={() => setActiveTab('list')}>批次列表</button>
        {selectedBatch && <button className={`px-4 py-2 ${activeTab === 'detail' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-500'}`} onClick={() => setActiveTab('detail')}>批次详情</button>}
        {selectedBatch && <button className={`px-4 py-2 ${activeTab === 'preview' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-500'}`} onClick={loadPreview}>影响预览</button>}
      </div>

      {loading && <div className="text-center py-8 text-gray-500">处理中...</div>}

      {activeTab === 'list' && (
        <div className="bg-white rounded-lg shadow">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">批次号</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">标题</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">状态</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">创建人</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">创建时间</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {batches.length === 0 ? (
                  <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-500">暂无批次数据</td></tr>
                ) : batches.map(b => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-sm">{b.batch_no}</td>
                    <td className="px-4 py-3">{b.title}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${statusMap[b.status]?.color}`}>{statusMap[b.status]?.label}</span>
                    </td>
                    <td className="px-4 py-3 text-sm">{b.created_by}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{b.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => loadBatchDetail(b.id)} className="text-primary-600 hover:underline text-sm">查看</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'detail' && batchDetail && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">{batchDetail.batch.title}</h2>
                <div className="flex items-center gap-4 mt-2">
                  <span className="font-mono text-sm text-gray-500">{batchDetail.batch.batch_no}</span>
                  <span className={`px-2 py-1 rounded-full text-xs ${statusMap[batchDetail.batch.status]?.color}`}>{statusMap[batchDetail.batch.status]?.label}</span>
                </div>
                {batchDetail.batch.reason && <p className="text-gray-600 mt-2">原因：{batchDetail.batch.reason}</p>}
                {batchDetail.batch.remarks && <p className="text-gray-500 text-sm mt-1">备注：{batchDetail.batch.remarks}</p>}
              </div>
              <div className="flex gap-2">
                {['draft', 'pending'].includes(batchDetail.batch.status) && (
                  <>
                    <button onClick={loadPreview} className="btn btn-secondary">预览影响</button>
                    {batchDetail.batch.status === 'draft' && items.length > 0 && (
                      <button onClick={saveDraft} className="btn btn-primary">保存草稿</button>
                    )}
                    {batchDetail.batch.status === 'pending' && user.role === 'admin' && (
                      <button onClick={executeBatch} className="btn btn-primary">正式执行</button>
                    )}
                    <button onClick={revokeBatch} className="btn btn-danger">撤销批次</button>
                  </>
                )}
                {batchDetail.batch.status === 'completed' && (
                  <>
                    <button onClick={() => downloadCsv('affected')} className="btn btn-secondary">导出受影响</button>
                    <button onClick={() => downloadCsv('results')} className="btn btn-secondary">导出结果</button>
                    <button onClick={() => downloadCsv('unprocessed')} className="btn btn-secondary">导出未处理</button>
                  </>
                )}
              </div>
            </div>
          </div>

          {['draft'].includes(batchDetail.batch.status) && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">停诊条目</h3>
                <button onClick={() => setShowImport(true)} className="btn btn-secondary text-sm">📥 CSV导入</button>
              </div>
              
              <div className="flex gap-2 mb-4">
                <select value={newItem.type} onChange={e => setNewItem({ ...newItem, type: e.target.value })} className="input w-32">
                  <option value="date">按日期</option>
                  <option value="doctor">按医生</option>
                  <option value="room">按诊室</option>
                </select>
                {newItem.type === 'date' ? (
                  <input type="date" value={newItem.value} max={today} onChange={e => setNewItem({ ...newItem, value: e.target.value })} className="input flex-1" />
                ) : newItem.type === 'doctor' ? (
                  <select value={newItem.value} onChange={e => setNewItem({ ...newItem, value: e.target.value })} className="input flex-1">
                    <option value="">请选择医生</option>
                    {doctors.map(d => <option key={d.id} value={d.id}>{d.name} - {d.department}</option>)}
                  </select>
                ) : (
                  <input type="text" value={newItem.value} onChange={e => setNewItem({ ...newItem, value: e.target.value })} placeholder="输入诊室名称" className="input flex-1" />
                )}
                <input type="text" value={newItem.description} onChange={e => setNewItem({ ...newItem, description: e.target.value })} placeholder="描述（可选）" className="input flex-1" />
                <button onClick={addItem} className="btn btn-primary">添加</button>
              </div>

              {items.length > 0 && (
                <>
                  <div className="space-y-2 mb-4">
                    {items.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded">
                        <span className="text-xl">{itemTypeMap[item.type]?.icon}</span>
                        <span className={`px-2 py-1 rounded text-xs ${statusMap.draft.color}`}>{itemTypeMap[item.type]?.label}</span>
                        <span className="font-medium">{item.value}</span>
                        {item.description && <span className="text-gray-500 text-sm">({item.description})</span>}
                        <button onClick={() => removeItem(idx)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={saveItems} className="btn btn-primary">保存条目</button>
                </>
              )}
            </div>
          )}

          {batchDetail.summary && (
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-lg shadow p-6 text-center">
                <div className="text-3xl font-bold text-primary-600">{batchDetail.summary.slotCount}</div>
                <div className="text-gray-500 mt-1">受影响号源</div>
              </div>
              <div className="bg-white rounded-lg shadow p-6 text-center">
                <div className="text-3xl font-bold text-orange-600">{batchDetail.summary.appointmentCount}</div>
                <div className="text-gray-500 mt-1">受影响预约</div>
              </div>
              <div className="bg-white rounded-lg shadow p-6 text-center">
                <div className="text-3xl font-bold text-purple-600">{batchDetail.summary.waitlistCount}</div>
                <div className="text-gray-500 mt-1">受影响候补</div>
              </div>
            </div>
          )}

          {batchDetail.affectedSlots.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">受影响号源</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">日期</th>
                      <th className="px-3 py-2 text-left">时段</th>
                      <th className="px-3 py-2 text-left">医生</th>
                      <th className="px-3 py-2 text-left">科室</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {batchDetail.affectedSlots.map(s => (
                      <tr key={s.id}>
                        <td className="px-3 py-2">{s.date}</td>
                        <td className="px-3 py-2">{s.period === 'morning' ? '上午' : s.period === 'afternoon' ? '下午' : '晚上'}</td>
                        <td className="px-3 py-2">{s.doctor_name}</td>
                        <td className="px-3 py-2">{s.department}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {batchDetail.affectedAppointments.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">受影响预约</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">患者</th>
                      <th className="px-3 py-2 text-left">电话</th>
                      <th className="px-3 py-2 text-left">日期</th>
                      <th className="px-3 py-2 text-left">医生</th>
                      <th className="px-3 py-2 text-left">原状态</th>
                      <th className="px-3 py-2 text-left">处理状态</th>
                      <th className="px-3 py-2 text-left">处理结果</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {batchDetail.affectedAppointments.map(a => (
                      <tr key={a.id}>
                        <td className="px-3 py-2">{a.patient_name}</td>
                        <td className="px-3 py-2">{a.phone}</td>
                        <td className="px-3 py-2">{a.date}</td>
                        <td className="px-3 py-2">{a.doctor_name}</td>
                        <td className="px-3 py-2">{a.old_status === 'confirmed' ? '已确认' : a.old_status}</td>
                        <td className="px-3 py-2">{a.processed ? '已处理' : '未处理'}</td>
                        <td className="px-3 py-2">{a.process_result || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {batchDetail.affectedWaitlist.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">受影响候补</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">患者</th>
                      <th className="px-3 py-2 text-left">电话</th>
                      <th className="px-3 py-2 text-left">日期</th>
                      <th className="px-3 py-2 text-left">医生</th>
                      <th className="px-3 py-2 text-left">原状态</th>
                      <th className="px-3 py-2 text-left">处理状态</th>
                      <th className="px-3 py-2 text-left">处理结果</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {batchDetail.affectedWaitlist.map(w => (
                      <tr key={w.id}>
                        <td className="px-3 py-2">{w.patient_name}</td>
                        <td className="px-3 py-2">{w.phone}</td>
                        <td className="px-3 py-2">{w.date}</td>
                        <td className="px-3 py-2">{w.doctor_name}</td>
                        <td className="px-3 py-2">{w.old_status === 'waiting' ? '等候中' : w.old_status}</td>
                        <td className="px-3 py-2">{w.processed ? '已处理' : '未处理'}</td>
                        <td className="px-3 py-2">{w.process_result || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {batchDetail.notifications.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">患者通知</h3>
              <div className="space-y-3">
                {batchDetail.notifications.map(n => (
                  <div key={n.id} className="p-4 bg-gray-50 rounded border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{n.patient_name} ({n.phone})</span>
                      <div className="flex gap-2">
                        <span className={`px-2 py-1 rounded text-xs ${statusMap.pending.color}`}>
                          {n.notification_type === 'appointment_cancelled' ? '预约取消' : 
                           n.notification_type === 'auto_postponed' ? '自动顺延' : '人工确认'}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs ${n.sent ? statusMap.completed.color : statusMap.draft.color}`}>
                          {n.sent ? '已发送' : '待发送'}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700">{n.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batchDetail.revocation && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-red-800 mb-2">撤销记录</h3>
              <p className="text-red-700">原因：{batchDetail.revocation.reason || '未填写'}</p>
              <p className="text-sm text-red-600 mt-2">
                恢复预约：{batchDetail.revocation.restored_appointments} | 
                恢复候补：{batchDetail.revocation.restored_waitlist} | 
                释放号源：{batchDetail.revocation.restored_slots}
              </p>
              <p className="text-xs text-red-500 mt-1">操作人：{batchDetail.revocation.created_by} | 时间：{batchDetail.revocation.created_at?.slice(0, 16).replace('T', ' ')}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'preview' && preview && (
        <div className="space-y-6">
          {preview.conflicts.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-red-800 mb-2">⚠️ 号源冲突</h3>
              <p className="text-red-700">以下号源已被其他未完成批次占用，请先处理冲突：</p>
              <div className="mt-3 space-y-2">
                {preview.conflicts.map((c, i) => (
                  <div key={i} className="p-3 bg-red-100 rounded text-sm">
                    号源ID: {c.slot_id} | 批次: {c.batch_no} ({c.title}) | 状态: {statusMap[c.status]?.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <div className="text-3xl font-bold text-primary-600">{preview.totals.slotCount}</div>
              <div className="text-gray-500 mt-1">受影响号源</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <div className="text-3xl font-bold text-orange-600">{preview.totals.appointmentCount}</div>
              <div className="text-gray-500 mt-1">受影响预约</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <div className="text-3xl font-bold text-purple-600">{preview.totals.waitlistCount}</div>
              <div className="text-gray-500 mt-1">受影响候补</div>
            </div>
            <div className={`rounded-lg shadow p-6 text-center ${preview.totals.conflictCount > 0 ? 'bg-red-50' : 'bg-white'}`}>
              <div className={`text-3xl font-bold ${preview.totals.conflictCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{preview.totals.conflictCount}</div>
              <div className="text-gray-500 mt-1">冲突号源</div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => setActiveTab('detail')} className="btn btn-secondary">返回详情</button>
            {preview.totals.conflictCount === 0 && selectedBatch?.status === 'draft' && (
              <button onClick={saveDraft} className="btn btn-primary">保存草稿并锁定号源</button>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">新建停诊批次</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">批次标题 *</label>
                <input className="input w-full" value={newBatch.title} onChange={e => setNewBatch({ ...newBatch, title: e.target.value })} placeholder="如：2024-01-15 张医生停诊" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">停诊原因</label>
                <input className="input w-full" value={newBatch.reason} onChange={e => setNewBatch({ ...newBatch, reason: e.target.value })} placeholder="如：医生外出开会" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">备注</label>
                <textarea className="input w-full" value={newBatch.remarks} onChange={e => setNewBatch({ ...newBatch, remarks: e.target.value })} rows="2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreate(false)} className="btn btn-secondary">取消</button>
              <button onClick={createBatch} className="btn btn-primary" disabled={loading}>{loading ? '创建中...' : '创建批次'}</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl">
            <h3 className="text-lg font-bold mb-4">CSV 导入停诊名单</h3>
            <p className="text-sm text-gray-500 mb-2">格式：类型,值,描述（可选）  类型支持：日期/医生/诊室</p>
            <p className="text-xs text-gray-400 mb-4">示例：<br/>类型,值,描述<br/>日期,2024-01-15,全天停诊<br/>医生,1,张医生停诊</p>
            <textarea className="input w-full font-mono text-sm" value={importContent} onChange={e => setImportContent(e.target.value)} rows="8" placeholder="类型,值,描述&#10;日期,2024-01-15,全天停诊&#10;医生,1,张医生外出开会" />
            {importResult && importResult.errors.length > 0 && (
              <div className="mt-3 p-3 bg-red-50 rounded text-sm text-red-700">
                <div className="font-medium mb-1">导入错误：</div>
                {importResult.errors.map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setShowImport(false); setImportContent(''); setImportResult(null); }} className="btn btn-secondary">关闭</button>
              <button onClick={handleImport} className="btn btn-primary" disabled={loading}>{loading ? '导入中...' : '解析并导入'}</button>
            </div>
          </div>
        </div>
      )}

      {showConfig && config && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">停诊配置</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">候补处理策略</label>
                <select className="input w-full" value={config.waitlistStrategy} onChange={e => updateConfigValue('suspension_waitlist_strategy', e.target.value)} disabled={user.role !== 'admin'}>
                  <option value="auto_postpone">自动顺延至下一可用号源</option>
                  <option value="manual_review">进入人工确认列表</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">决定停诊后候补患者的处理方式</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">自动发送通知</label>
                <select className="input w-full" value={config.autoNotify} onChange={e => updateConfigValue('suspension_auto_notify', e.target.value)} disabled={user.role !== 'admin'}>
                  <option value="true">是</option>
                  <option value="false">否</option>
                </select>
              </div>
            </div>
            {user.role !== 'admin' && <p className="text-sm text-red-500 mt-4">只有管理员可以修改配置</p>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowConfig(false)} className="btn btn-secondary">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Suspension
