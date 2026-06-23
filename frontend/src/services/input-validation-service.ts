import { ApiClient } from './api-client';

export interface InputValidationRule {
  id: string;
  name: string;
  dataType: 'string' | 'number' | 'date' | 'array';
  required: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface InputValidationCreateParams {
  name: string;
  dataType: 'string' | 'number' | 'date' | 'array';
  required: boolean;
  description: string;
  scenario?: string;
}

export interface InputValidationUpdateParams {
  id: string;
  name?: string;
  dataType?: 'string' | 'number' | 'date' | 'array';
  required?: boolean;
  description?: string;
  scenario?: string;
}

interface InputValidationResponse {
  inputs: InputValidationRule[];
}

export class InputValidationService {
  private static BASE_PATH = '/api/input-validation';

  public static async getAll(scenario: string = 'DEFAULT'): Promise<InputValidationRule[]> {
    const response = await ApiClient.get<InputValidationResponse>(this.BASE_PATH, {
      queryParams: { scenario },
    });
    return response.inputs || [];
  }

  public static async getById(id: string): Promise<InputValidationRule> {
    return ApiClient.get<InputValidationRule>(`${this.BASE_PATH}/${id}`);
  }

  public static async create(params: InputValidationCreateParams): Promise<InputValidationRule> {
    return ApiClient.post<InputValidationRule>(this.BASE_PATH, {
      body: params,
    });
  }

  public static async update(params: InputValidationUpdateParams): Promise<InputValidationRule> {
    const { id, ...updateData } = params;
    return ApiClient.put<InputValidationRule>(`${this.BASE_PATH}/${id}`, {
      body: updateData,
    });
  }

  public static async delete(id: string, scenario: string = 'DEFAULT'): Promise<void> {
    return ApiClient.delete<void>(`${this.BASE_PATH}/${id}`, {
      queryParams: { scenario },
    });
  }

  public static async validateInput(input: Record<string, any>): Promise<{ valid: boolean; errors?: Record<string, string> }> {
    return ApiClient.post<{ valid: boolean; errors?: Record<string, string> }>(`${this.BASE_PATH}/validate`, {
      body: { input },
    });
  }

  public static async saveAll(scenario: string, inputs: InputValidationCreateParams[]): Promise<void> {
    return ApiClient.put<void>(this.BASE_PATH, {
      body: { scenario, inputs },
    });
  }
}