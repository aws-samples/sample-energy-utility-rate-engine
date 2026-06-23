import { ApiClient } from './api-client';

// Individual RDL line (stored in the lines array)
export interface RdlLine {
  id: string;
  order: number;
  code: string;
}

// Complete RDL data for a scenario (single DynamoDB item)
export interface RdlData {
  scenario: string;
  lines: RdlLine[];
  createdAt: string | null;
  updatedAt: string | null;
}

// Parameters for saving RDL data
export interface RdlSaveParams {
  scenario: string;
  lines: RdlLine[];
}

export class RdlService {
  private static BASE_PATH = '/api/rdl';

  // Get all RDL lines for a scenario
  public static async getAll(scenario: string): Promise<RdlLine[]> {
    const response = await ApiClient.get<RdlData>(this.BASE_PATH, {
      queryParams: { scenario },
    });
    return response.lines || [];
  }

  // Get full RDL data including metadata
  public static async getData(scenario: string): Promise<RdlData> {
    return ApiClient.get<RdlData>(this.BASE_PATH, {
      queryParams: { scenario },
    });
  }

  // Save all RDL lines for a scenario (replaces entire set)
  public static async save(params: RdlSaveParams): Promise<RdlData> {
    return ApiClient.put<RdlData>(this.BASE_PATH, {
      body: params,
    });
  }

  // Delete all RDL lines for a scenario
  public static async deleteAll(scenario: string): Promise<void> {
    return ApiClient.delete<void>(this.BASE_PATH, {
      queryParams: { scenario },
    });
  }
}