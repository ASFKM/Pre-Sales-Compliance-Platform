// Centralized API client for Commercial Assistant AI B2B Platform
const API_BASE = "";

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  correlationId?: string;
}

export class ApiClient {
  private static getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-correlation-id": `corr-client-${Math.random().toString(36).substring(2, 11)}`,
      ...customHeaders,
    };

    const token = localStorage.getItem("ca_session_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  private static async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 401) {
      // Clear expired or invalid session token and force user logout
      localStorage.removeItem("ca_session_token");
      localStorage.removeItem("ca_user");
      // Optionally reload the page or trigger an event to redirect to login
      window.dispatchEvent(new Event("unauthorized"));
    }

    if (!response.ok) {
      let errorMsg = "An error occurred during the API request.";
      try {
        const errorData = await response.json();
        errorMsg = errorData.message || errorMsg;
      } catch (e) {
        // Fallback if response isn't JSON
      }
      throw new Error(errorMsg);
    }

    return response.json();
  }

  public static async get<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${API_BASE}${url}`, {
      method: "GET",
      headers: this.getHeaders(headers),
    });
    return this.handleResponse<T>(res);
  }

  public static async post<T>(url: string, body: any, headers: Record<string, string> = {}): Promise<T> {
    const isMultipart = body instanceof FormData;
    
    const requestHeaders = isMultipart 
      ? this.getHeaders(headers)
      : this.getHeaders({ ...headers, "Content-Type": "application/json" });
    
    if (isMultipart) {
      delete requestHeaders["Content-Type"]; // Multer needs to set its own boundaries
    }

    const res = await fetch(`${API_BASE}${url}`, {
      method: "POST",
      headers: requestHeaders,
      body: isMultipart ? body : JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  public static async put<T>(url: string, body: any, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${API_BASE}${url}`, {
      method: "PUT",
      headers: this.getHeaders(headers),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  public static async delete<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${API_BASE}${url}`, {
      method: "DELETE",
      headers: this.getHeaders(headers),
    });
    return this.handleResponse<T>(res);
  }
}
export default ApiClient;
