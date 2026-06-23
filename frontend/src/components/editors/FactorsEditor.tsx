import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Scenario } from '../../types/updatedRates';
import { Loader2, Upload, Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FactorService, Factor } from '../../services/factor-service';

interface FactorsEditorProps {
  scenario: Scenario;
}

interface ValidationError {
  row: number;
  message: string;
}

const FactorsEditor: React.FC<FactorsEditorProps> = ({ scenario }) => {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [replaceAll, setReplaceAll] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFactors = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const data = await FactorService.getFactors(scenario);
      setFactors(data);
    } catch (err) {
      console.error('Error loading factors:', err);
      setLoadError('Failed to load factors. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [scenario]);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  const parseCSV = (csvText: string): Factor[] => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }
    const dataLines = lines.slice(1);
    const rows: Factor[] = [];
    for (const line of dataLines) {
      if (!line.trim()) continue;
      const values = line.split(',').map(v => v.trim());
      if (values.length < 8) {
        throw new Error(`Row has insufficient columns: ${line}`);
      }
      rows.push({
        key1: values[0], key2: values[1], key3: values[2], key4: values[3], key5: values[4],
        value: parseFloat(values[5]), start_date: values[6], end_date: values[7]
      });
    }
    return rows;
  };

  const validateFactors = (rows: Factor[]): ValidationError[] => {
    const errors: ValidationError[] = [];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    rows.forEach((row, index) => {
      const rowNum = index + 2;
      if (!row.key1) errors.push({ row: rowNum, message: 'key1 is required' });
      if (isNaN(row.value)) errors.push({ row: rowNum, message: 'value must be a valid number' });
      if (!dateRegex.test(row.start_date)) errors.push({ row: rowNum, message: 'start_date must be in YYYY-MM-DD format' });
      if (!dateRegex.test(row.end_date)) errors.push({ row: rowNum, message: 'end_date must be in YYYY-MM-DD format' });
      if (dateRegex.test(row.start_date) && dateRegex.test(row.end_date) && row.start_date > row.end_date) {
        errors.push({ row: rowNum, message: 'start_date must be before or equal to end_date' });
      }
    });
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const r1 = rows[i], r2 = rows[j];
        if (r1.key1 === r2.key1 && r1.key2 === r2.key2 && r1.key3 === r2.key3 && r1.key4 === r2.key4 && r1.key5 === r2.key5) {
          if (!(r1.end_date < r2.start_date || r1.start_date > r2.end_date)) {
            errors.push({ row: i + 2, message: `Overlapping date range with row ${j + 2} for same key combination` });
          }
        }
      }
    }
    return errors;
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setIsUploading(true);
      setValidationErrors([]);
      setNotification(null);
      const text = await file.text();
      const rows = parseCSV(text);
      const errors = validateFactors(rows);
      if (errors.length > 0) {
        setValidationErrors(errors);
        setNotification({ type: 'error', message: `Found ${errors.length} validation error(s). Please fix and try again.` });
        return;
      }
      await FactorService.uploadFactors(scenario, rows, replaceAll);
      setNotification({ type: 'success', message: `Successfully uploaded ${rows.length} factor(s)` });
      loadFactors();
    } catch (err) {
      console.error('Error processing CSV:', err);
      setNotification({ type: 'error', message: err instanceof Error ? err.message : 'Failed to process CSV file' });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleDownloadCSV = () => {
    const header = 'key1,key2,key3,key4,key5,value,start_date,end_date\n';
    const rows = factors.map(f =>
      `${f.key1},${f.key2},${f.key3},${f.key4},${f.key5},${f.value},${f.start_date},${f.end_date}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `factors_${scenario}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setNotification({ type: 'success', message: 'CSV file downloaded successfully' });
    setTimeout(() => setNotification(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <h3 className="text-lg font-semibold">Loading factors...</h3>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">Factors - {scenario}</h2>
          <p className="text-sm text-muted-foreground">Upload CSV files to bulk import factors or download current factors as CSV</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Switch id="replace-all" checked={replaceAll} onCheckedChange={setReplaceAll} />
            <Label htmlFor="replace-all">Replace all</Label>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
          <Button variant="outline" onClick={handleUploadClick} disabled={isUploading}>
            {isUploading ? <Loader2 className="animate-spin" /> : <Upload />}
            {isUploading ? 'Uploading...' : 'Upload CSV'}
          </Button>
          <Button variant="outline" onClick={handleDownloadCSV} disabled={factors.length === 0}>
            <Download /> Download CSV
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Error loading data</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
          <AlertAction><Button variant="ghost" size="icon-xs" onClick={() => setLoadError(null)}><X className="size-3" /></Button></AlertAction>
        </Alert>
      )}

      {notification && (
        <Alert variant={notification.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{notification.message}</AlertDescription>
          <AlertAction><Button variant="ghost" size="icon-xs" onClick={() => setNotification(null)}><X className="size-3" /></Button></AlertAction>
        </Alert>
      )}

      {validationErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Validation Errors</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {validationErrors.slice(0, 10).map((error, idx) => (
                <li key={idx}>Row {error.row}: {error.message}</li>
              ))}
              {validationErrors.length > 10 && (
                <li>... and {validationErrors.length - 10} more error(s)</li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* CSV Format Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expected CSV Format</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <code className="block rounded bg-muted p-3 text-sm">
            key1,key2,key3,key4,key5,value,start_date,end_date<br />
            RESIDENTIAL,CUSTOMER_CHARGE,,,, 15.00,2023-01-01,2023-12-31<br />
            RESIDENTIAL,ENERGY_CHARGE,,,, 0.11,2023-01-01,9999-12-31
          </code>
          <p className="text-sm text-muted-foreground">
            - key1 is required, other keys are optional<br />
            - value must be a numeric value<br />
            - Dates must be in YYYY-MM-DD format<br />
            - Date ranges cannot overlap for the same key combination<br />
            - <strong>Replace all</strong>: ON = delete existing factors before upload (full replacement); OFF = merge/upsert with existing
          </p>
        </CardContent>
      </Card>

      {/* Table */}
      {factors.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
          <p>No factors available</p>
          <Button variant="outline" onClick={handleUploadClick}><Upload /> Upload CSV</Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Key 1</TableHead>
                <TableHead className="w-[120px]">Key 2</TableHead>
                <TableHead className="w-[120px]">Key 3</TableHead>
                <TableHead className="w-[120px]">Key 4</TableHead>
                <TableHead className="w-[120px]">Key 5</TableHead>
                <TableHead className="w-[100px]">Value</TableHead>
                <TableHead className="w-[120px]">Start Date</TableHead>
                <TableHead className="w-[120px]">End Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {factors.map((factor, idx) => (
                <TableRow key={idx} className="even:bg-muted/50">
                  <TableCell>{factor.key1 || '-'}</TableCell>
                  <TableCell>{factor.key2 || '-'}</TableCell>
                  <TableCell>{factor.key3 || '-'}</TableCell>
                  <TableCell>{factor.key4 || '-'}</TableCell>
                  <TableCell>{factor.key5 || '-'}</TableCell>
                  <TableCell>{factor.value.toFixed(4)}</TableCell>
                  <TableCell>{factor.start_date}</TableCell>
                  <TableCell>{factor.end_date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default FactorsEditor;
