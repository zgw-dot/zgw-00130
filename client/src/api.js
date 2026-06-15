import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 15000
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
      if (location.hash !== '#/login') {
        window.location.hash = '#/login'
      }
    }
    return Promise.reject(err)
  }
)

export const toast = (msg, type = 'info') => {
  const color = type === 'error' ? 'bg-rose-600' : type === 'success' ? 'bg-emerald-600' : 'bg-gray-700'
  const el = document.createElement('div')
  el.className = `fixed top-4 right-4 z-[9999] ${color} text-white px-4 py-2 rounded-md shadow-lg text-sm`
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2800)
}

export const suspensionApi = {
  listBatches: (status) => api.get('/suspension/batches', { params: { status } }),
  createBatch: (data) => api.post('/suspension/batches', data),
  getBatch: (id) => api.get(`/suspension/batches/${id}`),
  updateItems: (id, items) => api.post(`/suspension/batches/${id}/items`, { items }),
  preview: (id) => api.get(`/suspension/batches/${id}/preview`),
  saveDraft: (id) => api.post(`/suspension/batches/${id}/save-draft`),
  execute: (id) => api.post(`/suspension/batches/${id}/execute`),
  revoke: (id, reason) => api.post(`/suspension/batches/${id}/revoke`, { reason }),
  importCsv: (content) => api.post('/suspension/csv/import', { content }),
  exportAffected: (batchId) => api.get(`/suspension/csv/export/${batchId}/affected`, { responseType: 'blob' }),
  exportResults: (batchId) => api.get(`/suspension/csv/export/${batchId}/results`, { responseType: 'blob' }),
  exportUnprocessed: (batchId) => api.get(`/suspension/csv/export/${batchId}/unprocessed`, { responseType: 'blob' }),
  listExports: (batchId) => api.get('/suspension/exports', { params: { batchId } }),
  getConfig: () => api.get('/suspension/config'),
  updateConfig: (key, value) => api.put('/suspension/config', { key, value }),
  getDoctors: () => api.get('/doctors'),
  getSlots: (params) => api.get('/slots', { params })
}

export const roomApi = {
  list: () => api.get('/rooms'),
  get: (id) => api.get(`/rooms/${id}`),
  create: (data) => api.post('/rooms', data),
  update: (id, data) => api.put(`/rooms/${id}`, data),
  remove: (id) => api.delete(`/rooms/${id}`),
  calendar: (params) => api.get('/rooms/calendar/view', { params }),
  previewLock: (id, params) => api.get(`/rooms/${id}/preview-lock`, { params })
}

export const rescheduleApi = {
  listBatches: (status) => api.get('/reschedule/batches', { params: { status } }),
  createBatch: (data) => api.post('/reschedule/batches', data),
  getBatch: (id) => api.get(`/reschedule/batches/${id}`),
  updateItems: (id, items) => api.post(`/reschedule/batches/${id}/items`, { items }),
  setTargets: (id, targetMap) => api.post(`/reschedule/batches/${id}/targets`, { targetMap }),
  preview: (id) => api.get(`/reschedule/batches/${id}/preview`),
  execute: (id) => api.post(`/reschedule/batches/${id}/execute`),
  revoke: (id, reason) => api.post(`/reschedule/batches/${id}/revoke`, { reason }),
  revokeItem: (batchId, itemId, reason) => api.post(`/reschedule/batches/${batchId}/items/${itemId}/revoke`, { reason }),
  getConfig: () => api.get('/reschedule/config'),
  updateConfig: (key, value) => api.put('/reschedule/config', { key, value }),
  getAvailableSlots: (sourceSlotId, mode) => api.get('/reschedule/available-slots', { params: { sourceSlotId, mode } }),
  getAppointments: (params) => api.get('/reschedule/appointments', { params }),
  getWaitlist: (params) => api.get('/reschedule/waitlist', { params }),
  importCsv: (content) => api.post('/reschedule/csv/import', { content }),
  exportSuccess: (batchId) => api.get(`/reschedule/csv/export/${batchId}/success`, { responseType: 'blob' }),
  exportFailure: (batchId) => api.get(`/reschedule/csv/export/${batchId}/failure`, { responseType: 'blob' }),
  exportAll: (batchId) => api.get(`/reschedule/csv/export/${batchId}/all`, { responseType: 'blob' }),
  listExports: (batchId) => api.get('/reschedule/exports', { params: { batchId } }),
  getDoctors: () => api.get('/doctors'),
  getSlots: (params) => api.get('/slots', { params })
}

export default api
