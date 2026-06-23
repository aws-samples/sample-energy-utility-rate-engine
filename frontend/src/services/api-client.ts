import { fetchAuthSession } from 'aws-amplify/auth';
import { amplifyConfig } from '../config/amplify-config';

// Get API endpoint from configuration
const API_ENDPOINT = amplifyConfig.API.REST.RateEngineAPI.endpoint;

// Interface for API request options
interface ApiRequestOptions {
  body?: any;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
}

// Generic API client for making authenticated requests
export class ApiClient {
  private static async getAuthHeaders(): Promise<Record<string, string>> {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();

      if (idToken) {
        return {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        };
      }

      // No token available - user is not authenticated
      return {
        'Content-Type': 'application/json',
      };
    } catch (error) {
      console.error('Error getting auth headers:', error);
      return {
        'Content-Type': 'application/json',
      };
    }
  }

  private static buildUrl(path: string, queryParams?: Record<string, string>): string {
    // Handle relative API endpoints to work with CloudFront routing
    let fullUrl: URL;

    if (!API_ENDPOINT || API_ENDPOINT.startsWith('/')) {
      // Empty or relative path - use current origin (CloudFront)
      fullUrl = new URL(`${window.location.origin}${API_ENDPOINT}${path}`);
    } else {
      // Absolute URL - use as is
      fullUrl = new URL(`${API_ENDPOINT}${path}`);
    }

    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          fullUrl.searchParams.append(key, value);
        }
      });
    }

    return fullUrl.toString();
  }

  // GET request
  public static async get<T>(
    path: string,
    options?: ApiRequestOptions
  ): Promise<T> {
    const headers = {
      ...(await this.getAuthHeaders()),
      ...(options?.headers || {}),
    };

    const url = this.buildUrl(path, options?.queryParams);

    const response = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'same-origin', // Only send credentials for same-origin requests
    });

    if (!response.ok) {
      console.error('API Error:', {
        status: response.status,
        statusText: response.statusText,
        url,
      });

      // Try to get the error body if available
      let errorBody = '';
      try {
        errorBody = await response.text();
        console.error('Error response body:', errorBody);
      } catch {
        console.error('Could not read error response body');
      }

      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // POST request
  public static async post<T>(
    path: string,
    options?: ApiRequestOptions
  ): Promise<T> {
    const headers = {
      ...(await this.getAuthHeaders()),
      ...(options?.headers || {}),
    };

    const url = this.buildUrl(path);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin', // Only send credentials for same-origin requests
    });

    if (!response.ok) {
      console.error('API Error:', {
        status: response.status,
        statusText: response.statusText,
        url,
      });

      // Try to get the error body if available
      let errorBody = '';
      try {
        errorBody = await response.text();
        console.error('Error response body:', errorBody);
      } catch {
        console.error('Could not read error response body');
      }

      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // PUT request
  public static async put<T>(
    path: string,
    options?: ApiRequestOptions
  ): Promise<T> {
    const headers = {
      ...(await this.getAuthHeaders()),
      ...(options?.headers || {}),
    };

    const url = this.buildUrl(path, options?.queryParams);

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin', // Only send credentials for same-origin requests
    });

    if (!response.ok) {
      console.error('API Error:', {
        status: response.status,
        statusText: response.statusText,
        url,
      });

      // Try to get the error body if available
      let errorBody = '';
      try {
        errorBody = await response.text();
        console.error('Error response body:', errorBody);
      } catch {
        console.error('Could not read error response body');
      }

      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // DELETE request
  public static async delete<T>(
    path: string,
    options?: ApiRequestOptions
  ): Promise<T> {
    const headers = {
      ...(await this.getAuthHeaders()),
      ...(options?.headers || {}),
    };

    const url = this.buildUrl(path, options?.queryParams);

    const response = await fetch(url, {
      method: 'DELETE',
      headers,
      credentials: 'same-origin', // Only send credentials for same-origin requests
    });

    if (!response.ok) {
      console.error('API Error:', {
        status: response.status,
        statusText: response.statusText,
        url,
      });

      // Try to get the error body if available
      let errorBody = '';
      try {
        errorBody = await response.text();
        console.error('Error response body:', errorBody);
      } catch {
        console.error('Could not read error response body');
      }

      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
}