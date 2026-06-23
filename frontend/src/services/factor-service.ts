import { ApiClient } from './api-client';

export interface Factor {
  key1: string;
  key2: string;
  key3: string;
  key4: string;
  key5: string;
  value: number;
  start_date: string;
  end_date: string;
}

interface FactorsResponse {
  factors: Factor[];
}

export class FactorService {
  private static BASE_PATH = '/api/factors';

  /**
   * Get all factors for a scenario
   */
  public static async getFactors(scenario: string): Promise<Factor[]> {
    const response = await ApiClient.get<FactorsResponse>(this.BASE_PATH, {
      queryParams: { scenario },
    });
    return response.factors || [];
  }

  /**
   * Upload factors for a scenario
   * @param replaceAll If true, deletes all existing factors before uploading
   */
  public static async uploadFactors(scenario: string, factors: Factor[], replaceAll: boolean = false): Promise<void> {
    await ApiClient.post<void>(`${this.BASE_PATH}/upload`, {
      body: { scenario, factors, replaceAll },
    });
  }

  /**
   * Delete all factors for a scenario
   */
  public static async deleteFactors(scenario: string): Promise<void> {
    await ApiClient.delete<void>(this.BASE_PATH, {
      queryParams: { scenario },
    });
  }
}
