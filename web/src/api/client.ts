import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

// Origin serving uploaded files (API_URL without the trailing /api).
export const API_ORIGIN = API_URL.replace(/\/api\/?$/, "");

/** Resolves a stored image path (e.g. /uploads/products/x.jpg) to a full URL. */
export function imageSrc(imageUrl?: string | null): string | undefined {
  if (!imageUrl) return undefined;
  if (/^https?:\/\//.test(imageUrl)) return imageUrl;
  return `${API_ORIGIN}${imageUrl}`;
}

export const api = axios.create({ baseURL: API_URL });

const TOKEN_KEY = "dsrj_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      setToken(null);
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { error?: string } | undefined)?.error ?? error.message ?? fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
