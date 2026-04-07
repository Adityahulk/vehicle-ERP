import axios from 'axios';
import { toast } from 'sonner';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Auto-refresh on 401
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const { data } = await axios.post(
            `${import.meta.env.VITE_API_URL || '/api'}/auth/refresh`,
            { refresh_token: refreshToken },
          );
          localStorage.setItem('access_token', data.access_token);
          localStorage.setItem('refresh_token', data.refresh_token);
          originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
          return api(originalRequest);
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
          return Promise.reject(error);
        }
      }

      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
    }

    // Toast error for mutation requests (POST, PATCH, PUT, DELETE)
    const method = (originalRequest?.method || '').toLowerCase();
    if (['post', 'patch', 'put', 'delete'].includes(method)) {
      const message =
        error.response?.data?.error ||
        error.response?.data?.message ||
        'Something went wrong';

      // Rate limiting
      if (error.response?.status === 429) {
        toast.error('Too many requests. Please slow down.');
      } else if (error.response?.status !== 401) {
        toast.error(message);
      }
    }

    return Promise.reject(error);
  },
);

export default api;

/**
 * Helper to show success toasts after mutations.
 * Usage: api.post(...).then(res => { showSuccess('Vehicle added'); return res; })
 */
export function showSuccess(message) {
  toast.success(message);
}

export function showError(message) {
  toast.error(message || 'Something went wrong');
}
