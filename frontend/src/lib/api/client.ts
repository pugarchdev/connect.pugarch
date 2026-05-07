import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
const API_TIMEOUT_MS = 30000;

class APIClient {
  private client: AxiosInstance;

  private listeners: ((event: any) => void)[] = [];

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: API_TIMEOUT_MS,
      headers: {
        // Let Axios handle Content-Type automatically (especially for FormData)
      },
    });

    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const token = this.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        
        // Emit request log
        this.emitLog({
          type: 'info',
          source: 'API_REQ',
          message: `${config.method?.toUpperCase()} ${config.url}`,
          timestamp: new Date().toISOString()
        });

        return config;
      },
      (error) => {
        this.emitLog({
          type: 'error',
          source: 'API_ERR',
          message: `Request failed: ${error.message}`,
          timestamp: new Date().toISOString()
        });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        // Emit success log
        this.emitLog({
          type: 'success',
          source: 'API_RES',
          message: `${response.config.method?.toUpperCase()} ${response.config.url} ${response.status} OK`,
          timestamp: new Date().toISOString()
        });
        return response;
      },
      (error) => {
        const status = error.response?.status || 'ERR';
        const method = error.config?.method?.toUpperCase() || '???';
        const url = error.config?.url || '???';
        const isTimeout = error.code === 'ECONNABORTED';
        const errorMessage = isTimeout
          ? `Request timed out after ${API_TIMEOUT_MS / 1000}s`
          : (error.response?.data?.message || error.message);

        this.emitLog({
          type: 'error',
          source: 'API_RES',
          message: `${method} ${url} ${status} - ${errorMessage}`,
          timestamp: new Date().toISOString()
        });

        if (error.response?.status === 401) {
          const currentToken = this.getToken();
          const isLoginRequest = error.config?.url?.includes('/auth/login') || 
                                 error.config?.url?.includes('/auth/sso');
          
          if (currentToken && !isLoginRequest) {
            this.removeToken();
            if (typeof window !== 'undefined') {
              window.location.href = '/';
            }
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Log Subscription System
  private emitLog(log: any) {
    this.listeners.forEach(cb => cb(log));
  }

  public subscribe(callback: (event: any) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  private getToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('accessToken');
    }
    return null;
  }

  private removeToken(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  }

  public setToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', token);
    }
  }

  public setRefreshToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('refreshToken', token);
    }
  }

  public async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url, config);
    return response.data;
  }

  public async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(url, data, config);
    return response.data;
  }

  public async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(url, data, config);
    return response.data;
  }

  public async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.patch(url, data, config);
    return response.data;
  }

  public async delete<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(url, { ...config, data });
    return response.data;
  }
}

export const apiClient = new APIClient();
