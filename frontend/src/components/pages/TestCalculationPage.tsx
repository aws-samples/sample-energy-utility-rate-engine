import React, { useState, useEffect } from 'react';
import { TestPayloadService, TestPayload, PayloadWithOverrides } from '../../services/test-payload-service';
import { ApiClient } from '../../services/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, CheckCircle, AlertCircle, Plus, Save, Trash2 } from 'lucide-react';

interface TestCalculationPageProps {
  scenario?: string;
}

interface OutputItem {
  category: string;
  field: string;
  value: number;
}

interface CalculationResult {
  status: string;
  output: OutputItem[];
  errors?: string[];
  debug?: Record<string, any>;
  request?: any;
}

interface BatchResult {
  input: object;
  result: CalculationResult;
}

const TestCalculationPage: React.FC<TestCalculationPageProps> = ({ scenario: propScenario }) => {
  const [scenario, setScenario] = useState(propScenario || 'DEFAULT');
  const [inputPayload, setInputPayload] = useState<string>('[]');
  const [results, setResults] = useState<BatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  // Payload management state
  const [payloads, setPayloads] = useState<TestPayload[]>([]);
  const [selectedPayload, setSelectedPayload] = useState<string | null>(null);
  const [isLoadingPayloads, setIsLoadingPayloads] = useState(true);
  const [isSaveModalVisible, setIsSaveModalVisible] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [newPayloadName, setNewPayloadName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Update scenario when prop changes
  useEffect(() => {
    const storedScenario = sessionStorage.getItem('selectedScenario');
    if (storedScenario) {
      setScenario(storedScenario);
    } else if (propScenario) {
      setScenario(propScenario);
    }

    const handleScenarioChange = () => {
      const newScenario = sessionStorage.getItem('selectedScenario');
      if (newScenario && newScenario !== scenario) {
        setScenario(newScenario);
        setSelectedPayload(null);
        setInputPayload('[]');
      }
    };

    window.addEventListener('scenarioChanged', handleScenarioChange);
    return () => window.removeEventListener('scenarioChanged', handleScenarioChange);
  }, [propScenario, scenario]);

  // Load test payloads
  useEffect(() => {
    const loadPayloads = async () => {
      try {
        setIsLoadingPayloads(true);
        const data = await TestPayloadService.getAll(scenario);
        setPayloads(data);

        // Auto-select the first payload only if none is selected yet. Use the
        // functional update form so this effect doesn't depend on selectedPayload.
        const firstPayload = data[0];
        if (firstPayload) {
          setSelectedPayload((current) => {
            if (current) return current;
            setInputPayload(JSON.stringify(firstPayload.payload, null, 2));
            return firstPayload.name;
          });
        }
      } catch (err) {
        console.error('Error loading payloads:', err);
      } finally {
        setIsLoadingPayloads(false);
      }
    };

    loadPayloads();
  }, [scenario]);

  const handlePayloadSelect = (value: string) => {
    setSelectedPayload(value);
    const payload = payloads.find(p => p.name === value);
    if (payload) {
      setInputPayload(JSON.stringify(payload.payload, null, 2));
    }
  };

  const handleSavePayload = async () => {
    if (!newPayloadName.trim()) {
      setSaveError('Please enter a name for the payload');
      return;
    }

    try {
      setSaveError(null);
      const parsedPayload = JSON.parse(inputPayload);

      let payloadToSave: PayloadWithOverrides;
      if (Array.isArray(parsedPayload)) {
        payloadToSave = { overrides: {}, inputs: parsedPayload };
      } else if (parsedPayload.inputs && Array.isArray(parsedPayload.inputs)) {
        payloadToSave = {
          overrides: parsedPayload.overrides || {},
          inputs: parsedPayload.inputs,
        };
      } else {
        payloadToSave = { overrides: {}, inputs: [parsedPayload] };
      }

      await TestPayloadService.create({
        name: newPayloadName.trim(),
        payload: payloadToSave,
        scenario,
      });

      const data = await TestPayloadService.getAll(scenario);
      setPayloads(data);
      setSelectedPayload(newPayloadName.trim());
      setIsSaveModalVisible(false);
      setNewPayloadName('');
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setSaveError('Invalid JSON in payload');
      } else {
        setSaveError(err.message || 'Failed to save payload');
      }
    }
  };

  const handleUpdatePayload = async () => {
    if (!selectedPayload) return;

    try {
      const parsedPayload = JSON.parse(inputPayload);

      let payloadToSave: PayloadWithOverrides;
      if (Array.isArray(parsedPayload)) {
        payloadToSave = { overrides: {}, inputs: parsedPayload };
      } else if (parsedPayload.inputs && Array.isArray(parsedPayload.inputs)) {
        payloadToSave = {
          overrides: parsedPayload.overrides || {},
          inputs: parsedPayload.inputs,
        };
      } else {
        payloadToSave = { overrides: {}, inputs: [parsedPayload] };
      }

      await TestPayloadService.update(selectedPayload, {
        payload: payloadToSave,
        scenario,
      });

      const data = await TestPayloadService.getAll(scenario);
      setPayloads(data);
    } catch (err: any) {
      setError(err.message || 'Failed to update payload');
    }
  };

  const handleDeletePayload = async () => {
    if (!selectedPayload) return;

    try {
      await TestPayloadService.delete(selectedPayload, scenario);

      const data = await TestPayloadService.getAll(scenario);
      setPayloads(data);

      if (data.length > 0) {
        setSelectedPayload(data[0].name);
        setInputPayload(JSON.stringify(data[0].payload, null, 2));
      } else {
        setSelectedPayload(null);
        setInputPayload('[]');
      }

      setIsDeleteModalVisible(false);
    } catch (err: any) {
      setError(err.message || 'Failed to delete payload');
    }
  };

  const runCalculation = async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    setExecutionTime(null);

    try {
      const parsedInput = JSON.parse(inputPayload);

      let requestBody: PayloadWithOverrides;

      if (Array.isArray(parsedInput)) {
        requestBody = { overrides: {}, inputs: parsedInput };
      } else if (parsedInput.inputs && Array.isArray(parsedInput.inputs)) {
        requestBody = {
          overrides: parsedInput.overrides || {},
          inputs: parsedInput.inputs,
        };
      } else {
        requestBody = { overrides: {}, inputs: [parsedInput] };
      }

      const startTime = performance.now();

      const data = await ApiClient.post<{ results: BatchResult[] }>(
        `/api/calculate/${scenario}`,
        { body: requestBody }
      );

      const endTime = performance.now();
      setExecutionTime(Math.round((endTime - startTime) * 100) / 100);
      setResults(data.results);
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON in input payload');
      } else {
        setError(err.message || 'Failed to run calculation');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(value);
  };

  const getTotal = (output: OutputItem[]): number => {
    const totalItem = output.find(item => item.field.toLowerCase() === 'total');
    return totalItem ? totalItem.value : 0;
  };

  const renderOutputTable = (output: OutputItem[]) => {
    const categories = new Map<string, OutputItem[]>();
    output.forEach(item => {
      const list = categories.get(item.category) || [];
      list.push(item);
      categories.set(item.category, list);
    });

    return (
      <div className="flex flex-col gap-1 text-sm">
        {Array.from(categories.entries()).map(([category, items]) => (
          <details key={category} open>
            <summary className="cursor-pointer font-medium py-1">{category}</summary>
            <div className="pl-4">
              {items.map(item => (
                <div key={item.field} className="flex justify-between py-0.5 font-mono text-xs">
                  <span>{item.field}</span>
                  <span className={item.value > 0 ? 'font-semibold' : ''}>{formatCurrency(item.value)}</span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    );
  };

  const renderSingleResult = (batchResult: BatchResult, index: number) => {
    const { input, result } = batchResult;
    const inputSummary = (input as any).RATE ? `${(input as any).RATE} - ${(input as any).KWH} kWh` : `Input ${index + 1}`;
    const total = getTotal(result.output || []);
    const hasErrors = result.errors && result.errors.length > 0;

    return (
      <Card key={index}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{inputSummary}</CardTitle>
            <span className="text-2xl font-bold text-green-600">{formatCurrency(total)}</span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {hasErrors && (
            <Alert variant="destructive">
              <AlertDescription>
                {result.errors!.map((err, i) => <div key={i}>{err}</div>)}
              </AlertDescription>
            </Alert>
          )}

          {result.output && result.output.length > 0 && renderOutputTable(result.output)}

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Input JSON</summary>
            <pre className="mt-1 p-2 bg-muted rounded overflow-auto max-h-40">{JSON.stringify(input, null, 2)}</pre>
          </details>

          {result.debug && Object.keys(result.debug).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Debug Info</summary>
              <pre className="mt-1 p-2 bg-muted rounded overflow-auto max-h-40">{JSON.stringify(result.debug, null, 2)}</pre>
            </details>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Test Calculation</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Test the deployed rate calculator for scenario: {scenario}</p>
            </div>
            <Button onClick={runCalculation} disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              Run Calculation
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-4 min-w-0">
              <div>
                <Label>Saved Payloads</Label>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <Select value={selectedPayload ?? ''} onValueChange={handlePayloadSelect}>
                    <SelectTrigger>
                      <SelectValue placeholder={isLoadingPayloads ? 'Loading payloads...' : 'Select a payload'} />
                    </SelectTrigger>
                    <SelectContent>
                      {payloads.map(p => (
                        <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => setIsSaveModalVisible(true)}>
                    <Plus className="size-4" /> New
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleUpdatePayload} disabled={!selectedPayload}>
                    <Save className="size-4" /> Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setIsDeleteModalVisible(true)} disabled={!selectedPayload}>
                    <Trash2 className="size-4" /> Delete
                  </Button>
                </div>
              </div>

              <div>
                <Label>Input Payload (JSON)</Label>
                <p className="text-xs text-muted-foreground mb-1.5">{'Format: { overrides: { BILL_DATE_OFFSET_YEARS?: 1 }, inputs: [{...}] }'}</p>
                <Textarea
                  value={inputPayload}
                  onChange={(e) => setInputPayload(e.target.value)}
                  className="font-mono text-sm h-96 overflow-auto"
                  placeholder='{"overrides": {}, "inputs": [{"RATE": "RES", "KWH": 1000, ...}]}'
                />
              </div>
            </div>

            <div className="min-w-0">
              {loading && (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                  <p className="text-muted-foreground mt-2">Running calculation...</p>
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Calculation Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {results.length > 0 && !loading && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-600">
                      <CheckCircle className="size-3" />
                      {results.length} calculation(s) completed
                    </Badge>
                    {executionTime !== null && (
                      <span className="text-xs text-muted-foreground">Total time: {executionTime}ms</span>
                    )}
                  </div>

                  {results.length > 1 && (
                    <Card>
                      <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
                      <CardContent>
                        <span className="text-3xl font-bold text-green-600">
                          {formatCurrency(results.reduce((sum, r) => sum + getTotal(r.result.output || []), 0))}
                        </span>
                        <p className="text-xs text-muted-foreground">Total of {results.length} calculations</p>
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex flex-col gap-3">
                    {results.map((r, i) => renderSingleResult(r, i))}
                  </div>
                </div>
              )}

              {results.length === 0 && !loading && !error && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <p>Select a payload or enter values and click "Run Calculation"</p>
                  <p className="text-xs">Make sure you have deployed the calculator for this scenario first.</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Payload Modal */}
      <Dialog open={isSaveModalVisible} onOpenChange={(open) => { if (!open) { setIsSaveModalVisible(false); setSaveError(null); setNewPayloadName(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Test Payload</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {saveError && (
              <Alert variant="destructive">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label>Payload Name</Label>
              <Input
                value={newPayloadName}
                onChange={(e) => setNewPayloadName(e.target.value)}
                placeholder="Enter a name for this payload"
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsSaveModalVisible(false); setSaveError(null); setNewPayloadName(''); }}>
              Cancel
            </Button>
            <Button onClick={handleSavePayload}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={isDeleteModalVisible} onOpenChange={setIsDeleteModalVisible}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Test Payload</DialogTitle>
          </DialogHeader>
          <p>Are you sure you want to delete "{selectedPayload}"? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteModalVisible(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeletePayload}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TestCalculationPage;
