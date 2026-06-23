import { ApiClient } from './api-client';

export interface FunctionParameter {
  name: string;
  type: string;
  description: string;
}

export interface FunctionReturn {
  type: string;
  description: string;
}

export interface CustomFunction {
  id: string;
  name: string;
  signature: string;
  description: string;
  parameters: FunctionParameter[];
  returns: FunctionReturn;
  example: string;
  rustCode: string;
}

interface CustomFunctionsResponse {
  functions: CustomFunction[];
}

export class CustomFunctionsService {
  private static BASE_PATH = '/api/custom-functions';

  // Get all custom functions
  public static async getAll(): Promise<CustomFunction[]> {
    const response = await ApiClient.get<CustomFunctionsResponse>(this.BASE_PATH);
    return response.functions || [];
  }

  // Get a specific custom function by ID
  public static async getById(id: string): Promise<CustomFunction> {
    return ApiClient.get<CustomFunction>(`${this.BASE_PATH}/${id}`);
  }
}
