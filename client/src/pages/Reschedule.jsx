import { useState, useEffect, useCallback } from 'react'
import { rescheduleApi, toast } from '../api.js'

const statusMap = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-800' },
  previewed: { label: '已预览', color: 'bg-blue-100 text-blue-800' },
  executing: { label: '执行中', color: 'bg-yellow-100 text-yellow-800' },
  completed: { label: '已完成', color: 'bg-green-100 text-green-800' },
  revoked: { label: '已撤销', color: 'bg-red-100 text-red-800' }
}

const itemStatusMap = {
  pending: { label: '待处理', color: 'bg-gray-100 text-gray-700' },
  success: { label: '成功', color: 'bg-green-100 text-green-700' },
  failed: { label: '失败', color: 'bg-red-100 text-red-700' },
  skipped: { label: '跳过', color: 'bg-yellow-100 text-yellow-700' },
  cancelled: { label: '已撤销', color: 'bg-gray-200 text-gray-600' }
}

const periodMap = { morning: '上午', afternoon: '下午', evening: '晚上' }
const sourceTypeMap = { appointment: '预约', waitlist: '候补' }

function Reschedule({ user }) {
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
  const [filterDate, setFilterDate] = useState('')
  const [filterDoctor, setFilterDoctor] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [sourceList, setSourceList] = useState([])
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [sourceType, setSourceType] = useState('appointment')
  const [importContent, setImportContent] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const [targetMode, setTargetMode] = useState('same_doctor')
  const [availableSlots, setAvailableSlots] = useState([])
  const [targetSlotMap, setTargetSlotMap] = useState({})
  const [bulkTargetSlot, setBulkTargetSlot] = useState('')

  useEffect(() => {
    loadBatches()
    loadConfig()
    loadDoctors()
  }, [])

  const loadBatches = async () => {
    try {
      const res = await rescheduleApi.listBatches()
      setBatches(res.data.batches)
    } catch (e) {
      toast(e.response?.data?.error || '加载批次失败', 'error')
    }
  }

  const loadConfig = async () => {
    try {
      const res = await rescheduleApi.getConfig()
      setConfig(res.data.config)
    } catch (e) {}
  }

  const loadDoctors = async () => {
    try {
      const res = await rescheduleApi.getDoctors()
      setDoctors(res.data.doctors || res.data.list || [])
    } catch (e) {}
  }

  const loadBatchDetail = async (id) => {
    try {
      setLoading(true)
      const res = await rescheduleApi.getBatch(id)
      setBatchDetail(res.data)
      setSelectedBatch(res.data.batch)
      const map = {}
      res.data.items.forEach(item => {
        if (item.target_slot_id) map[item.id] = item.target_slot_id
      })
      setTargetSlotMap(map)
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
      const res = await rescheduleApi.createBatch(newBatch)
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

  const loadSourceList = async () => {
    if (!filterDate) {
      toast('请先选择日期', 'error')
      return
    }
    try {
      setLoading(true)
      const params = { date: filterDate }
      if (filterDoctor) params.doctorId = filterDoctor
      if (filterDept) params.department = filterDept

      let res
      if (sourceType === 'appointment') {
        res = await rescheduleApi.getAppointments(params)
      } else {
        res = await rescheduleApi.getWaitlist(params)
      }
      setSourceList(res.data.list || [])
      setSelectedItems(new Set())
    } catch (e) {
      toast(e.response?.data?.error || '加载列表失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const toggleSelectItem = (id) => {
    const newSet = new Set(selectedItems)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedItems(newSet)
  }

  const toggleSelectAll = () => {
    if (selectedItems.size === sourceList.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(sourceList.map(i => i.id)))
    }
  }

  const addSelectedToBatch = async () => {
    if (!selectedBatch) {
      toast('请先选择或创建批次', 'error')
      return
    }
    if (selectedItems.size === 0) {
      toast('请选择要添加的条目', 'error')
      return
    }
    try {
      setLoading(true)
      const items = Array.from(selectedItems).map(id => ({
        source_type: sourceType,
        source_id: id
      }))
      await rescheduleApi.updateItems(selectedBatch.id, items)
      toast(`已添加 ${items.length} 条记录到批次`, 'success')
      await loadBatchDetail(selectedBatch.id)
    } catch (e) {
      toast(e.response?.data?.error || '添加失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadAvailableSlots = async (sourceSlotId) => {
    if (!sourceSlotId) return
    try {
      const res = await rescheduleApi.getAvailableSlots(sourceSlotId, targetMode)
      setAvailableSlots(res.data.slots || [])
    } catch (e) {
      toast(e.response?.data?.error || '加载可用号源失败', 'error')
    }
  }

  const setBulkTarget = () => {
    if (!bulkTargetSlot) {
      toast('请选择目标号源', 'error')
      return
    }
    const map = { ...targetSlotMap }
    batchDetail?.items?.forEach(item => {
      map[item.id] = parseInt(bulkTargetSlot)
    })
    setTargetSlotMap(map)
    toast(`已为 ${batchDetail?.items?.length || 0} 条记录设置目标号源`, 'success')
  }

  const saveTargets = async () => {
    if (!selectedBatch) return
    try {
      setLoading(true)
      await rescheduleApi.setTargets(selectedBatch.id, targetSlotMap)
      toast('目标号源保存成功', 'success')
      await loadBatchDetail(selectedBatch.id)
    } catch (e) {
      toast(e.response?.data?.error || '保存目标号源失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadPreview = async () => {
    if (!selectedBatch) return
    try {
      setLoading(true)
      const res = await rescheduleApi.preview(selectedBatch.id)
      setPreview(res.data)
      setActiveTab('preview')
    } catch (e) {
      toast(e.response?.data?.error || '预览失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const executeBatch = async () => {
    if (!selectedBatch) return
    const canSubmit = config?.reschedule_clerk_can_submit || user.role === 'admin'
    if (!canSubmit) {
      toast('办事员无提交权限，请联系管理员', 'error')
      return
    }
    if (!window.confirm('确定要执行该改期批次吗？')) return
    try {
      setLoading(true)
      const res = await rescheduleApi.execute(selectedBatch.id)
      const s = res.data.stats
      toast(`执行完成：成功${s.success}，失败${s.failed}，候补${s.waitlisted || 0}`, 'success')
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
      const res = await rescheduleApi.revoke(selectedBatch.id, reason)
      const s = res.data.restoreStats
      toast(`撤销完成：恢复${s.restoredAppointments}个预约，${s.restoredWaitlist}个候补`, 'success')
      await loadBatchDetail(selectedBatch.id)
      await loadBatches()
    } catch (e) {
      toast(e.response?.data?.error || '撤销失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const revokeSingleItem = async (itemId) => {
    if (user.role !== 'admin') {
      toast('只有管理员可以撤销单笔', 'error')
      return
    }
    const reason = window.prompt('请输入撤销原因：')
    if (reason == null) return
    try {
      setLoading(true)
      await rescheduleApi.revokeItem(selectedBatch.id, itemId, reason)
      toast('单笔撤销成功', 'success')
      await loadBatchDetail(selectedBatch.id)
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
      const res = await rescheduleApi.importCsv(importContent)
      setImportResult(res.data)
      if (res.data.errors.length > 0) {
        toast(`导入完成：成功${res.data.success}，失败${res.data.errors.length}`, 'warning')
      } else {
        toast(`导入成功：${res.data.success} 条`, 'success')
      }
    } catch (e) {
      toast(e.response?.data?.error || '导入失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const addImportedToBatch = async () => {
    if (!selectedBatch || !importResult) return
    try {
      setLoading(true)
      const items = importResult.items.map(i => ({
        source_type: i.source_type,
        source_id: i.source_id
      }))
      await rescheduleApi.updateItems(selectedBatch.id, items)
      toast(`已添加 ${items.length} 条导入记录`, 'success')
      setShowImport(false)
      setImportResult(null)
      await loadBatchDetail(selectedBatch.id)
    } catch (e) {
      toast(e.response?.data?.error || '添加失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const exportCsv = async (type) => {
    if (!selectedBatch) return
    try {
      let res
      if (type === 'success') {
        res = await rescheduleApi.exportSuccess(selectedBatch.id)
      } else if (type === 'failure') {
        res = await rescheduleApi.exportFailure(selectedBatch.id)
      } else {
        res = await rescheduleApi.exportAll(selectedBatch.id)
      }
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disp = res.headers['content-disposition'] || ''
      const match = disp.match(/filename="?([^"]+)"?/)
      a.download = match ? decodeURIComponent(match[1]) : 'export.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast('导出成功', 'success')
    } catch (e) {
      toast(e.response?.data?.error || '导出失败', 'error')
    }
  }

  const updateConfigItem = async (key, value) => {
    if (user.role !== 'admin') {
      toast('只有管理员可以修改配置', 'error')
      return
    }
    try {
      await rescheduleApi.updateConfig(key, value)
      toast('配置更新成功', 'success')
      loadConfig()
    } catch (e) {
      toast(e.response?.data?.error || '配置更新失败', 'error')
    }
  }

  const departments = [...new Set(doctors.map(d => d.department))].filter(Boolean)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">🔄 预约改期工作台</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConfig(true)}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm"
          >
            ⚙️ 配置
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded text-sm"
          >
            + 新建批次
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="w-64 flex-shrink-0">
          <div className="bg-white rounded-lg border p-3">
            <h3 className="font-semibold text-sm mb-2">改期批次</h3>
            <div className="space-y-1 max-h-[calc(100vh-200px)] overflow-y-auto">
              {batches.map(b => (
                <div
                  key={b.id}
                  onClick={() => loadBatchDetail(b.id)}
                  className={`p-2 rounded cursor-pointer text-sm ${
                    selectedBatch?.id === b.id ? 'bg-primary-50 border border-primary-200' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium truncate">{b.title}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${statusMap[b.status]?.color}`}>
                      {statusMap[b.status]?.label}
                    </span>
                    <span className="text-xs text-gray-500">{b.batch_no}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {b.total_items} 条 · 成功{b.success_count} · 失败{b.failed_count}
                  </div>
                </div>
              ))}
              {batches.length === 0 && (
                <div className="text-center text-gray-400 text-sm py-4">暂无批次</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white rounded-lg border">
          <div className="border-b px-4 py-2 flex gap-1">
            {['list', 'detail', 'preview', 'export'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-sm rounded ${
                  activeTab === tab ? 'bg-primary-100 text-primary-700' : 'hover:bg-gray-100 text-gray-600'
                }`}
              >
                {tab === 'list' && '筛选添加'}
                {tab === 'detail' && '批次明细'}
                {tab === 'preview' && '冲突预览'}
                {tab === 'export' && '导入导出'}
              </button>
            ))}
          </div>

          <div className="p-4">
            {activeTab === 'list' && (
              <div>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">日期</label>
                    <input
                      type="date"
                      value={filterDate}
                      onChange={e => setFilterDate(e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">来源类型</label>
                    <select
                      value={sourceType}
                      onChange={e => setSourceType(e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    >
                      <option value="appointment">预约</option>
                      <option value="waitlist">候补</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">医生</label>
                    <select
                      value={filterDoctor}
                      onChange={e => setFilterDoctor(e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">全部医生</option>
                      {doctors.map(d => (
                        <option key={d.id} value={d.id}>{d.name} - {d.department}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">科室</label>
                    <select
                      value={filterDept}
                      onChange={e => setFilterDept(e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">全部科室</option>
                      {departments.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={loadSourceList}
                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded text-sm"
                  >
                    查询
                  </button>
                  <button
                    onClick={() => setShowImport(true)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm"
                  >
                    📥 CSV导入
                  </button>
                  <button
                    onClick={addSelectedToBatch}
                    disabled={!selectedBatch || selectedItems.size === 0}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    添加到当前批次 ({selectedItems.size})
                  </button>
                  {selectedBatch && (
                    <span className="text-sm text-gray-500 ml-2">
                      当前批次：<span className="font-medium">{selectedBatch.title}</span>
                    </span>
                  )}
                </div>

                <div className="border rounded">
                  <div className="bg-gray-50 px-3 py-2 border-b flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={sourceList.length > 0 && selectedItems.size === sourceList.length}
                      onChange={toggleSelectAll}
                      className="rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      共 {sourceList.length} 条记录
                    </span>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {sourceList.map(item => (
                      <div
                        key={item.id}
                        className={`px-3 py-2 border-b last:border-b-0 flex items-center gap-2 hover:bg-gray-50 cursor-pointer ${
                          selectedItems.has(item.id) ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => toggleSelectItem(item.id)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedItems.has(item.id)}
                          onChange={() => toggleSelectItem(item.id)}
                          onClick={e => e.stopPropagation()}
                          className="rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">
                            {item.patient_name}
                            <span className="text-gray-400 text-xs ml-2">{item.phone}</span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {item.date} {periodMap[item.period]} {item.doctor_name} ({item.department})
                          </div>
                        </div>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          item.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                          item.status === 'booked' ? 'bg-blue-100 text-blue-700' :
                          item.status === 'waiting' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {sourceTypeMap[sourceType]}
                        </span>
                      </div>
                    ))}
                    {sourceList.length === 0 && (
                      <div className="text-center text-gray-400 py-8 text-sm">
                        {filterDate ? '暂无符合条件的记录' : '请选择日期后查询'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'detail' && batchDetail && (
              <div>
                <div className="mb-4 p-3 bg-gray-50 rounded">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{batchDetail.batch.title}</h3>
                      <p className="text-xs text-gray-500 mt-1">
                        批次号：{batchDetail.batch.batch_no} · 创建人：{batchDetail.batch.created_by_name}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded text-sm ${statusMap[batchDetail.batch.status]?.color}`}>
                      {statusMap[batchDetail.batch.status]?.label}
                    </span>
                  </div>
                  <div className="flex gap-4 mt-2 text-sm">
                    <span>总数：<b>{batchDetail.stats.total}</b></span>
                    <span className="text-green-600">成功：<b>{batchDetail.stats.success}</b></span>
                    <span className="text-red-600">失败：<b>{batchDetail.stats.failed}</b></span>
                    <span className="text-yellow-600">待处理：<b>{batchDetail.stats.pending}</b></span>
                  </div>
                </div>

                {['draft', 'previewed'].includes(batchDetail.batch.status) && (
                  <div className="mb-4 p-3 border rounded bg-blue-50">
                    <div className="text-sm font-medium mb-2">设置目标号源</div>
                    <div className="flex gap-2 items-end mb-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">查找方式</label>
                        <select
                          value={targetMode}
                          onChange={e => {
                            setTargetMode(e.target.value)
                            setAvailableSlots([])
                          }}
                          className="border rounded px-2 py-1.5 text-sm"
                        >
                          <option value="same_doctor">同医生</option>
                          <option value="same_department">同科室</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-gray-600 mb-1">批量目标号源</label>
                        <div className="flex gap-2">
                          <select
                            value={bulkTargetSlot}
                            onChange={e => setBulkTargetSlot(e.target.value)}
                            className="flex-1 border rounded px-2 py-1.5 text-sm"
                          >
                            <option value="">请先选择一条源号源查看可用号源</option>
                            {availableSlots.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.date} {periodMap[s.period]} {s.doctor_name} - 剩{s.available}个
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={setBulkTarget}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                          >
                            批量设置
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={saveTargets}
                        className="px-3 py-1.5 bg-primary-600 text-white rounded text-sm hover:bg-primary-700"
                      >
                        保存目标
                      </button>
                    </div>
                    {batchDetail.items.length > 0 && (
                      <button
                        onClick={() => loadAvailableSlots(batchDetail.items[0].source_slot_id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        加载可用号源（基于第一条记录的源号源）
                      </button>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mb-3">
                  {['draft', 'previewed'].includes(batchDetail.batch.status) && (
                    <>
                      <button
                        onClick={loadPreview}
                        className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded text-sm"
                      >
                        🔍 冲突预览
                      </button>
                      <button
                        onClick={executeBatch}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                      >
                        ✅ 执行改期
                      </button>
                    </>
                  )}
                  {batchDetail.batch.status === 'completed' && user.role === 'admin' && (
                    <button
                      onClick={revokeBatch}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                    >
                      ↩️ 撤销整批
                    </button>
                  )}
                </div>

                <div className="border rounded">
                  <div className="bg-gray-50 px-3 py-2 border-b text-sm font-medium">
                    改期条目 ({batchDetail.items.length})
                  </div>
                  <div className="max-h-[400px] overflow-y-auto">
                    {batchDetail.items.map(item => (
                      <div key={item.id} className="px-3 py-2 border-b last:border-b-0">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">
                              {item.patient_name}
                              <span className="text-gray-400 text-xs ml-2">{item.patient_phone}</span>
                            </div>
                            <div className="text-xs text-gray-500 flex gap-3 mt-1">
                              <span>
                                <b>源：</b>
                                {item.source_date} {periodMap[item.source_period]} {item.source_doctor_name}
                                ({sourceTypeMap[item.source_type]})
                              </span>
                              <span className={item.target_slot_id ? 'text-blue-600' : 'text-gray-400'}>
                                <b>目标：</b>
                                {item.target_slot_id
                                  ? `${item.target_date || ''} ${periodMap[item.target_period] || ''} ${item.target_doctor_name || ''}`
                                  : '未设置'}
                              </span>
                            </div>
                            {item.result_message && (
                              <div className="text-xs text-gray-600 mt-1">
                                结果：{item.result_message}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {['draft', 'previewed'].includes(batchDetail.batch.status) && (
                              <select
                                value={targetSlotMap[item.id] || ''}
                                onChange={e => {
                                  const map = { ...targetSlotMap }
                                  if (e.target.value) {
                                    map[item.id] = parseInt(e.target.value)
                                  } else {
                                    delete map[item.id]
                                  }
                                  setTargetSlotMap(map)
                                }}
                                onFocus={() => loadAvailableSlots(item.source_slot_id)}
                                className="text-xs border rounded px-1 py-1 w-36"
                              >
                                <option value="">选择目标号源</option>
                                {availableSlots.map(s => (
                                  <option key={s.id} value={s.id}>
                                    {s.date} {periodMap[s.period]} 剩{s.available}
                                  </option>
                                ))}
                              </select>
                            )}
                            <span className={`text-xs px-1.5 py-0.5 rounded ${itemStatusMap[item.status]?.color}`}>
                              {itemStatusMap[item.status]?.label}
                            </span>
                            {item.status === 'success' && batchDetail.batch.status === 'completed' && user.role === 'admin' && (
                              <button
                                onClick={() => revokeSingleItem(item.id)}
                                className="text-xs text-red-600 hover:text-red-700"
                              >
                                撤销
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {batchDetail.items.length === 0 && (
                      <div className="text-center text-gray-400 py-8 text-sm">
                        暂无条目，请在"筛选添加"标签页添加
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'preview' && preview && (
              <div>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="p-4 bg-blue-50 rounded text-center">
                    <div className="text-2xl font-bold text-blue-600">{preview.total}</div>
                    <div className="text-sm text-gray-600">总条目</div>
                  </div>
                  <div className="p-4 bg-green-50 rounded text-center">
                    <div className="text-2xl font-bold text-green-600">{preview.okCount}</div>
                    <div className="text-sm text-gray-600">可改期</div>
                  </div>
                  <div className="p-4 bg-red-50 rounded text-center">
                    <div className="text-2xl font-bold text-red-600">{preview.conflictCount}</div>
                    <div className="text-sm text-gray-600">有冲突</div>
                  </div>
                </div>

                {preview.conflicts.length > 0 && (
                  <div className="mb-4">
                    <h4 className="font-medium text-sm text-red-600 mb-2">⚠️ 冲突列表</h4>
                    <div className="border rounded">
                      {preview.conflicts.map((c, idx) => (
                        <div key={idx} className="px-3 py-2 border-b last:border-b-0 text-sm">
                          <span className="font-medium">{c.patient_name}</span>
                          <span className="mx-2 text-gray-400">-</span>
                          <span className="text-red-600">
                            {c.type === 'duplicate_patient' && '该患者在目标号源已有预约'}
                            {c.type === 'slot_full' && '目标号源已满'}
                            {c.type === 'slot_suspended' && '目标号源已停诊或锁定'}
                            {c.type === 'slot_closed' && '目标号源已关闭'}
                            {c.type === 'no_target' && '未设置目标号源'}
                            {c.type === 'target_not_found' && '目标号源不存在'}
                            {c.detail && `：${c.detail}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {preview.okItems.length > 0 && (
                  <div>
                    <h4 className="font-medium text-sm text-green-600 mb-2">✅ 可改期列表</h4>
                    <div className="border rounded max-h-64 overflow-y-auto">
                      {preview.okItems.map(item => (
                        <div key={item.item_id} className="px-3 py-2 border-b last:border-b-0 text-sm">
                          <span className="font-medium">{item.patient_name}</span>
                          <span className="mx-2 text-gray-400">→</span>
                          <span className="text-green-600">
                            {item.target_date} {periodMap[item.target_period]} {item.target_doctor}
                          </span>
                          {item.will_waitlist && (
                            <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                              将进入候补
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'export' && (
              <div>
                <h4 className="font-medium text-sm mb-3">导出</h4>
                <div className="flex gap-2 mb-6">
                  <button
                    onClick={() => exportCsv('success')}
                    disabled={!selectedBatch}
                    className="px-3 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded text-sm disabled:opacity-50"
                  >
                    📤 导出成功明细
                  </button>
                  <button
                    onClick={() => exportCsv('failure')}
                    disabled={!selectedBatch}
                    className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm disabled:opacity-50"
                  >
                    📤 导出失败明细
                  </button>
                  <button
                    onClick={() => exportCsv('all')}
                    disabled={!selectedBatch}
                    className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-sm disabled:opacity-50"
                  >
                    📤 导出全部明细
                  </button>
                </div>

                <h4 className="font-medium text-sm mb-3">CSV导入模板说明</h4>
                <div className="bg-gray-50 rounded p-3 text-sm">
                  <p className="text-gray-600 mb-2">CSV 必需列：类型, ID</p>
                  <p className="text-gray-500 text-xs">
                    类型：预约 / 候补<br/>
                    ID：对应的预约ID或候补ID<br/>
                    可选列：目标日期, 目标医生
                  </p>
                  <button
                    onClick={() => setShowImport(true)}
                    className="mt-3 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs"
                  >
                    立即导入
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'detail' && !batchDetail && (
              <div className="text-center text-gray-400 py-16">
                请从左侧选择一个批次，或新建批次
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="font-bold text-lg mb-4">新建改期批次</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">标题 *</label>
                <input
                  type="text"
                  value={newBatch.title}
                  onChange={e => setNewBatch({ ...newBatch, title: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="如：张医生6月15日停诊改期"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">原因</label>
                <input
                  type="text"
                  value={newBatch.reason}
                  onChange={e => setNewBatch({ ...newBatch, reason: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="医生临时停诊/患者改约"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">备注</label>
                <textarea
                  value={newBatch.remarks}
                  onChange={e => setNewBatch({ ...newBatch, remarks: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={createBatch}
                className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfig && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[500px] max-h-[80vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4">改期配置</h3>
            {config && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 border rounded">
                  <div>
                    <div className="font-medium text-sm">允许跨医生改签</div>
                    <div className="text-xs text-gray-500">开启后可改到同科室其他医生的号源</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.reschedule_allow_cross_doctor}
                      onChange={e => updateConfigItem('reschedule_allow_cross_doctor', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 border rounded">
                  <div>
                    <div className="font-medium text-sm">目标满额自动补位候补</div>
                    <div className="text-xs text-gray-500">目标号源已满时，自动加入目标号源的候补队列</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.reschedule_auto_fill_waitlist}
                      onChange={e => updateConfigItem('reschedule_auto_fill_waitlist', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 border rounded">
                  <div>
                    <div className="font-medium text-sm">办事员可提交改签</div>
                    <div className="text-xs text-gray-500">关闭后只有管理员能执行改期批次</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.reschedule_clerk_can_submit}
                      onChange={e => updateConfigItem('reschedule_clerk_can_submit', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>
              </div>
            )}
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setShowConfig(false)}
                className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[600px]">
            <h3 className="font-bold text-lg mb-4">CSV 导入待改期名单</h3>
            <div className="mb-3">
              <label className="block text-sm text-gray-600 mb-1">
                CSV 内容（类型, ID 两列必填；可选：目标日期, 目标医生）
              </label>
              <textarea
                value={importContent}
                onChange={e => setImportContent(e.target.value)}
                className="w-full border rounded px-3 py-2 font-mono text-xs"
                rows={8}
                placeholder="类型,ID
预约,1
预约,2
候补,5"
              />
            </div>
            <div className="flex gap-2 mb-4">
              <button
                onClick={handleImport}
                className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
              >
                解析CSV
              </button>
            </div>
            {importResult && (
              <div className="border rounded p-3 bg-gray-50">
                <div className="text-sm mb-2">
                  共 {importResult.total} 行，成功 {importResult.success} 条，失败 {importResult.errors.length} 条
                </div>
                {importResult.errors.length > 0 && (
                  <div className="text-xs text-red-600 mb-2">
                    错误：{importResult.errors.slice(0, 5).map(e => `第${e.line}行: ${e.error}`).join('；')}
                  </div>
                )}
                {selectedBatch && (
                  <button
                    onClick={addImportedToBatch}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                  >
                    添加到当前批次
                  </button>
                )}
                {!selectedBatch && (
                  <div className="text-xs text-gray-500">请先选择或创建一个批次</div>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => { setShowImport(false); setImportResult(null) }}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white px-6 py-4 rounded-lg shadow-lg">
            <div className="animate-spin w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full mx-auto"></div>
            <div className="text-sm mt-2">处理中...</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Reschedule
