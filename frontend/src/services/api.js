// Empty means "same origin", which is how the deployed build runs: one server
// hosts both the API and these pages. In development Vite is on another port,
// so VITE_API_URL points at the backend.
const API_URL = import.meta.env.VITE_API_URL ?? '';

/** Thrown for any non-2xx response, carrying the backend's safe message. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, options = {}) {
  // credentials: the login cookie is httpOnly, so it only travels if asked for.
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include', ...options });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(body?.error?.message || 'Something went wrong.', res.status);
  }
  return body;
}

/**
 * Uploads the three selfies. Uses XHR rather than fetch so the upload progress
 * is real: phone photos are several megabytes and the wait needs explaining.
 */
function searchEvent(eventId, selfies, { onUploadProgress } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    selfies.forEach((file, index) => form.append(`selfie${index + 1}`, file));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/events/${eventId}/search`);
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onUploadProgress?.(event.loaded / event.total);
    });

    xhr.addEventListener('load', () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* handled below */
      }

      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(body?.error?.message || 'Something went wrong.', xhr.status));
    });

    xhr.addEventListener('error', () => reject(new ApiError('Could not reach the server.', 0)));
    xhr.send(form);
  });
}

export const api = {
  loginUrl: `${API_URL}/api/auth/google`,

  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  events: () => request('/api/events'),
  event: (eventId) => request(`/api/events/${eventId}`),
  searchEvent,

  results: (searchId) => request(`/api/searches/${searchId}`),

  // Organizer only — the backend enforces the ADMIN_EMAILS allowlist.
  adminEvents: () => request('/api/admin/events'),
  syncEvents: () => request('/api/admin/events/sync', { method: 'POST' }),
  indexEvent: (eventId) => request(`/api/admin/events/${eventId}/index`, { method: 'POST' }),

  // Photo bytes come through the backend; the browser sends the login cookie
  // automatically. No Google Drive URL is ever involved.
  photoUrl: (searchId, photoId) => `${API_URL}/api/searches/${searchId}/photos/${photoId}`,
  downloadUrl: (searchId, photoId) =>
    `${API_URL}/api/searches/${searchId}/photos/${photoId}/download`,
};
