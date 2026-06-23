import { ApiClient } from './api-client';

export interface DeploymentStatus {
  deploymentId: string;
  scenario: string;
  status: 'PENDING' | 'GENERATING' | 'BUILDING' | 'DEPLOYING' | 'SUCCEEDED' | 'FAILED';
  buildId?: string;
  lambdaArn?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentResponse {
  deploymentId: string;
  scenario: string;
  status: string;
  message: string;
}

export interface CalculationInputItem {
  rate_code?: string;
  kwh?: number;
  kwd?: number;
  kwh_on_peak?: number;
  kwh_off_peak?: number;
  days_in_period?: number;
  billing_date?: string;
  tax_class?: string;
  riders?: string[];
  [key: string]: unknown;
}

export interface CalculationInput {
  scenario: string;
  input: CalculationInputItem | CalculationInputItem[];
}

export interface SingleCalculationResult {
  input: CalculationInputItem;
  result: {
    status: string;
    output: Record<string, number>;
    errors?: string[];
    debug?: Record<string, unknown>;
    request?: unknown;
  };
}

export interface CalculationResponse {
  scenario: string;
  results: SingleCalculationResult[];
}

export interface BatchUploadResponse {
  uploadUrl: string;
  batchId: string;
  inputPrefix: string;
  bucket: string;
}

export interface BatchStartResponse {
  batchId: string;
  scenario: string;
  status: string;
  message: string;
}

export interface BatchStatusResponse {
  batchId: string;
  scenario: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  message?: string;
  totalRecords?: number;
  successCount?: number;
  errorCount?: number;
  successRate?: number;
  filesProcessed?: number;
  outputPrefix?: string;
  completedAt?: string;
}

export interface BatchDownloadResponse {
  downloadUrl: string;
  filename: string;
  files: Array<{ key: string; size: number }>;
}

export class DeploymentService {
  /**
   * Start a deployment for a scenario
   */
  static async deploy(scenario: string): Promise<DeploymentResponse> {
    return ApiClient.post<DeploymentResponse>('/api/deploy', { body: { scenario } });
  }

  /**
   * Get deployment status by ID
   */
  static async getStatus(deploymentId: string): Promise<DeploymentStatus> {
    return ApiClient.get<DeploymentStatus>(`/api/deploy/${deploymentId}`);
  }

  /**
   * Get deployments for a scenario (sorted by createdAt descending)
   */
  static async getByScenario(scenario: string): Promise<DeploymentStatus[]> {
    const response = await ApiClient.get<{ deployments: DeploymentStatus[] }>(`/api/deploy?scenario=${encodeURIComponent(scenario)}`);
    return response.deployments;
  }

  /**
   * Poll deployment status until completion
   */
  static async pollStatus(
    deploymentId: string,
    onUpdate: (status: DeploymentStatus) => void,
    intervalMs = 15000,
    maxAttempts = 40
  ): Promise<DeploymentStatus> {
    let attempts = 0;

    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const status = await this.getStatus(deploymentId);
          onUpdate(status);

          if (status.status === 'SUCCEEDED' || status.status === 'FAILED') {
            resolve(status);
            return;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            reject(new Error('Deployment timed out'));
            return;
          }

          setTimeout(poll, intervalMs);
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }

  /**
   * Run calculation(s) against a deployed scenario
   * Calls the scenario-specific endpoint directly: /api/calculate/{scenario}
   * Input is an array of calculation inputs sent directly to the Rust Lambda
   */
  static async calculate(scenario: string, inputs: CalculationInputItem[]): Promise<CalculationResponse> {
    return ApiClient.post<CalculationResponse>(`/api/calculate/${scenario}`, { body: inputs });
  }

  // ===== BATCH PROCESSING METHODS =====

  /**
   * Get a presigned URL for uploading a batch file to S3
   */
  static async getUploadUrl(scenario: string, filename: string): Promise<BatchUploadResponse> {
    return ApiClient.post<BatchUploadResponse>('/api/batch/upload-url', {
      body: { scenario, filename },
    });
  }

  /**
   * Upload a file directly to S3 using a presigned URL
   */
  static async uploadToS3(uploadUrl: string, file: File | Blob): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': 'application/x-ndjson',
      },
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Start batch processing after file is uploaded
   * @param override Optional override object to apply to all calculations (e.g., { BILL_DATE_OFFSET_YEARS: 1 })
   */
  static async startBatch(scenario: string, batchId: string, override?: Record<string, unknown>): Promise<BatchStartResponse> {
    const body: Record<string, unknown> = { scenario, batchId };
    if (override && Object.keys(override).length > 0) {
      body.override = override;
    }
    return ApiClient.post<BatchStartResponse>('/api/batch/start', { body });
  }

  /**
   * Get batch processing status
   */
  static async getBatchStatus(batchId: string, scenario: string): Promise<BatchStatusResponse> {
    return ApiClient.get<BatchStatusResponse>(
      `/api/batch/${batchId}/status?scenario=${encodeURIComponent(scenario)}`
    );
  }

  /**
   * Get download URL for batch results
   */
  static async getDownloadUrl(
    batchId: string,
    scenario: string,
    filename?: string
  ): Promise<BatchDownloadResponse> {
    const params = new URLSearchParams({ scenario });
    if (filename) {
      params.append('filename', filename);
    }
    return ApiClient.get<BatchDownloadResponse>(`/api/batch/${batchId}/download-url?${params}`);
  }

  /**
   * Poll batch status until completion
   */
  static async pollBatchStatus(
    batchId: string,
    scenario: string,
    onUpdate: (status: BatchStatusResponse) => void,
    intervalMs = 3000,
    maxAttempts = 120
  ): Promise<BatchStatusResponse> {
    let attempts = 0;

    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const status = await this.getBatchStatus(batchId, scenario);
          onUpdate(status);

          if (status.status === 'COMPLETED') {
            resolve(status);
            return;
          }

          if (status.status === 'FAILED') {
            reject(new Error(status.message || 'Batch processing failed'));
            return;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            reject(new Error('Batch processing timed out'));
            return;
          }

          setTimeout(poll, intervalMs);
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }
}
