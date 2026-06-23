import React, { useState, useEffect } from 'react';
import { DeploymentService, BatchStatusResponse } from '../../services/deployment-service';
import { ScenarioService } from '../../services/scenario-service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, CheckCircle, Download, AlertCircle, Info } from 'lucide-react';

interface BatchAnalyticsPageProps {
  scenario?: string;
}

const BatchAnalyticsPage: React.FC<BatchAnalyticsPageProps> = () => {
  // Scenario selection
  const [scenario, setScenario] = useState<string>('DEFAULT');
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [scenarioLoaded, setScenarioLoaded] = useState(false);

  // File state
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Override JSON input
  const [overrideJson, setOverrideJson] = useState<string>('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // Batch processing state
  const [batchId, setBatchId] = useState<string>('');
  const [batchStatus, setBatchStatus] = useState<BatchStatusResponse | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Download URLs
  const [summaryUrl, setSummaryUrl] = useState<string>('');
  const [resultsUrl, setResultsUrl] = useState<string>('');

  // Load scenarios
  useEffect(() => {
    const loadScenarios = async () => {
      try {
        const scenarioList = await ScenarioService.getAll();
        const names = scenarioList.map(s => s.name);
        setScenarios(names);
        const defaultExists = names.includes('DEFAULT');
        if (defaultExists) {
          setScenario('DEFAULT');
        } else if (names.length > 0) {
          setScenario(names[0]);
        }
        setScenarioLoaded(true);
      } catch (err) {
        console.error('Failed to load scenarios:', err);
        setScenarioLoaded(true);
      }
    };
    loadScenarios();
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.jsonl') && !file.name.endsWith('.json')) {
        setError('Please select a JSONL or JSON file');
        return;
      }
      setBatchFile(file);
      setError(null);
      setBatchStatus(null);
      setSummaryUrl('');
      setResultsUrl('');
    }
  };

  const validateOverrideJson = (): Record<string, unknown> | null => {
    if (!overrideJson.trim()) {
      return {};
    }
    try {
      const parsed = JSON.parse(overrideJson);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setOverrideError('Override must be a JSON object (e.g., {"BILL_DATE_OFFSET_YEARS": 1})');
        return null;
      }
      setOverrideError(null);
      return parsed;
    } catch {
      setOverrideError('Invalid JSON format');
      return null;
    }
  };

  const runBatch = async () => {
    if (!batchFile || !scenario || !scenarioLoaded) return;

    const override = validateOverrideJson();
    if (override === null) return;

    setProcessing(true);
    setError(null);
    setBatchStatus(null);
    setSummaryUrl('');
    setResultsUrl('');

    try {
      const uploadResponse = await DeploymentService.getUploadUrl(scenario, batchFile.name);
      setBatchId(uploadResponse.batchId);

      await DeploymentService.uploadToS3(uploadResponse.uploadUrl, batchFile);

      await DeploymentService.startBatch(scenario, uploadResponse.batchId, override);

      // Poll every 5s for up to 30 min. The batch state machine allows up to 2 hours;
      // large batches easily exceed the old 6-min window, which surfaced a false
      // timeout in the UI while the job kept running and succeeded on the backend.
      await DeploymentService.pollBatchStatus(
        uploadResponse.batchId,
        scenario,
        (status) => setBatchStatus(status),
        5000,
        360
      );

      const downloadResponse = await DeploymentService.getDownloadUrl(
        uploadResponse.batchId,
        scenario,
        batchFile.name
      );
      setResultsUrl(downloadResponse.downloadUrl);

      const summaryResponse = await DeploymentService.getDownloadUrl(
        uploadResponse.batchId,
        scenario,
        'summary.json'
      );
      setSummaryUrl(summaryResponse.downloadUrl);

    } catch (err: any) {
      setError(err.message || 'Batch processing failed');
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setBatchFile(null);
    setOverrideJson('');
    setOverrideError(null);
    setBatchId('');
    setBatchStatus(null);
    setError(null);
    setSummaryUrl('');
    setResultsUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isCompleted = batchStatus?.status === 'COMPLETED';

  return (
    <div className="flex flex-col gap-6">
      {/* Upload Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Batch Processing</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Process large JSONL files with rate calculations</p>
            </div>
            <div className="flex items-center gap-2">
              {isCompleted && <Button variant="outline" onClick={reset}>New Batch</Button>}
              <Button onClick={runBatch} disabled={!batchFile || !scenarioLoaded || processing}>
                {processing && <Loader2 className="size-4 animate-spin" />}
                Run Batch
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-4">
                <div>
                  <Label>Scenario</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">Select the deployed scenario to use for calculations</p>
                  <Select value={scenario} onValueChange={setScenario} disabled={processing}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {scenarios.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Batch File</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">JSONL file with calculation inputs (one record per line)</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jsonl,.json"
                    onChange={handleFileSelect}
                    disabled={processing}
                    className="text-sm"
                  />
                  {batchFile && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {batchFile.name} ({(batchFile.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>
              </div>

              <div>
                <Label>Override (optional)</Label>
                <p className="text-xs text-muted-foreground mb-1.5">JSON object to apply to all calculations</p>
                <Textarea
                  value={overrideJson}
                  onChange={(e) => {
                    setOverrideJson(e.target.value);
                    setOverrideError(null);
                  }}
                  placeholder='{"BILL_DATE_OFFSET_YEARS": 1}'
                  rows={5}
                  disabled={processing}
                  className="font-mono text-sm"
                />
                {overrideError && <p className="text-xs text-destructive mt-1">{overrideError}</p>}
              </div>
            </div>

            <Accordion type="single" collapsible>
              <AccordionItem value="override-options">
                <AccordionTrigger>Override Options</AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground">
                    The override object is applied to all calculations in the batch. Common options:
                  </p>
                  <ul className="list-disc pl-5 my-2 text-sm">
                    <li><code>BILL_DATE_OFFSET_YEARS</code>: Offset the billing date by N years (e.g., 1 for future rates)</li>
                    <li><code>BILL_DATE_OFFSET_MONTHS</code>: Offset the billing date by N months</li>
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Example: <code>{`{"BILL_DATE_OFFSET_YEARS": 1}`}</code> processes all records with dates shifted 1 year forward.
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </CardContent>
      </Card>

      {/* Processing Status */}
      {processing && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground mt-2">
                {batchStatus?.status === 'PROCESSING'
                  ? `Processing... ${batchStatus?.filesProcessed || 0} file(s) processed`
                  : 'Uploading and starting batch...'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && !processing && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Processing Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {isCompleted && batchStatus && (
        <Card>
          <CardHeader><CardTitle>Batch Complete</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Records Processed</p>
                  <p className="text-3xl font-bold">{batchStatus.totalRecords?.toLocaleString() || 0}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Successful</p>
                  <p className="text-3xl font-bold text-green-600">{batchStatus.successCount?.toLocaleString() || 0}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Failed</p>
                  <p className={`text-3xl font-bold ${batchStatus.errorCount ? 'text-destructive' : ''}`}>
                    {batchStatus.errorCount?.toLocaleString() || 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Success Rate</p>
                  <p className="text-3xl font-bold">{batchStatus.successRate?.toFixed(1) || 100}%</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">Batch ID</p>
                <code className="text-sm">{batchId}</code>
              </div>

              <div className="flex items-center gap-2">
                <CheckCircle className="size-4 text-green-600" />
                <span className="text-sm">Processing complete</span>
                {batchStatus.completedAt && (
                  <span className="text-xs text-muted-foreground">
                    Completed at {new Date(batchStatus.completedAt).toLocaleString()}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {summaryUrl && (
                  <Button variant="outline" asChild>
                    <a href={summaryUrl} target="_blank" rel="noopener noreferrer">
                      <Download className="size-4" /> Download Summary (JSON)
                    </a>
                  </Button>
                )}
                {resultsUrl && (
                  <Button variant="outline" asChild>
                    <a href={resultsUrl} target="_blank" rel="noopener noreferrer">
                      <Download className="size-4" /> Download Results (JSONL)
                    </a>
                  </Button>
                )}
              </div>

              <Alert>
                <Info className="size-4" />
                <AlertDescription>
                  Results are stored in S3 at: <code>{batchStatus.outputPrefix}</code>
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!processing && !isCompleted && !batchFile && (
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center text-muted-foreground">
              <h3 className="text-lg font-semibold">Batch Rate Calculations</h3>
              <p className="mt-1">
                Upload a JSONL file with calculation inputs to process in batch.
                Results are saved to S3 for download or direct Athena queries.
              </p>
              <p className="text-xs mt-1">
                Optionally add an override JSON object to apply parameters like date offsets to all records.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BatchAnalyticsPage;
