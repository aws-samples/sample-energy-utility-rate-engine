import { ApiClient } from './api-client';

export interface Scenario {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioCreateParams {
  name: string;
  description: string;
  isDefault?: boolean;
  copyFrom?: string; // Scenario name to copy data from
}

export interface ScenarioUpdateParams {
  id: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
}

interface ScenariosResponse {
  scenarios: Scenario[];
}

export class ScenarioService {
  private static BASE_PATH = '/api/scenarios';

  public static async getAll(): Promise<Scenario[]> {
    const response = await ApiClient.get<ScenariosResponse>(this.BASE_PATH);
    return response.scenarios || [];
  }

  public static async getById(id: string): Promise<Scenario> {
    return ApiClient.get<Scenario>(`${this.BASE_PATH}/${id}`);
  }

  public static async create(params: ScenarioCreateParams): Promise<Scenario> {
    return ApiClient.post<Scenario>(this.BASE_PATH, {
      body: params,
    });
  }

  public static async update(params: ScenarioUpdateParams): Promise<Scenario> {
    const { id, ...updateData } = params;
    return ApiClient.put<Scenario>(`${this.BASE_PATH}/${id}`, {
      body: updateData,
    });
  }

  public static async delete(id: string): Promise<void> {
    return ApiClient.delete<void>(`${this.BASE_PATH}/${id}`);
  }

  public static async duplicate(id: string, newName: string): Promise<Scenario> {
    return ApiClient.post<Scenario>(`${this.BASE_PATH}/${id}/duplicate`, {
      body: { name: newName },
    });
  }
}