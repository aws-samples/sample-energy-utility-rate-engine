import { ApiClient } from './api-client';

export interface PayloadWithOverrides {
  overrides: Record<string, unknown>;
  inputs: object[];
}

export interface TestPayload {
  name: string;
  payload: object[] | PayloadWithOverrides; // Array of inputs or object with overrides
  scenario?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface TestPayloadsResponse {
  payloads: TestPayload[];
}

export class TestPayloadService {
  private static BASE_PATH = '/api/test-payloads';

  /**
   * Get all test payloads for a scenario
   */
  public static async getAll(scenario: string): Promise<TestPayload[]> {
    const response = await ApiClient.get<TestPayloadsResponse>(this.BASE_PATH, {
      queryParams: { scenario },
    });
    return response.payloads || [];
  }

  /**
   * Get a specific test payload by name
   */
  public static async getByName(name: string, scenario: string): Promise<TestPayload> {
    return ApiClient.get<TestPayload>(`${this.BASE_PATH}/${encodeURIComponent(name)}`, {
      queryParams: { scenario },
    });
  }

  /**
   * Create a new test payload
   */
  public static async create(payload: TestPayload): Promise<TestPayload> {
    return ApiClient.post<TestPayload>(this.BASE_PATH, {
      body: payload,
    });
  }

  /**
   * Update an existing test payload
   */
  public static async update(name: string, payload: Partial<TestPayload>): Promise<TestPayload> {
    return ApiClient.put<TestPayload>(`${this.BASE_PATH}/${encodeURIComponent(name)}`, {
      body: payload,
    });
  }

  /**
   * Delete a test payload
   */
  public static async delete(name: string, scenario: string): Promise<void> {
    await ApiClient.delete<void>(`${this.BASE_PATH}/${encodeURIComponent(name)}`, {
      queryParams: { scenario },
    });
  }
}
