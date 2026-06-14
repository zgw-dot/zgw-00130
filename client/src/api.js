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

export default api
