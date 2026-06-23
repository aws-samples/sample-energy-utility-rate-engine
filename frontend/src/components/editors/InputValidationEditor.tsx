import React, { useEffect, useState, useRef } from 'react';
import { InputVariable, Scenario, InputDataType } from '../../types/updatedRates';
import { Plus, X, Loader2, AlertCircle, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { InputValidationService } from '../../services/input-validation-service';

interface InputValidationEditorProps {
  scenario?: Scenario;
}

// Click-to-edit text cell
const EditableTextCell: React.FC<{
  value: string;
  onSave: (value: string) => Promise<void>;
  uppercase?: boolean;
  placeholder?: string;
}> = ({ value, onSave, uppercase, placeholder }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setEditValue(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const submit = async () => {
    const processed = uppercase ? editValue.toUpperCase() : editValue;
    setEditing(false);
    if (processed !== value) {
      try { await onSave(processed); } catch { setEditValue(value); }
    }
  };

  if (!editing) {
    return (
      <div
        className="cursor-pointer px-1 py-0.5 rounded hover:bg-muted min-h-[1.5rem]"
        onClick={() => setEditing(true)}
      >
        {value || <span className="text-muted-foreground">{placeholder || '-'}</span>}
      </div>
    );
  }

  return (
    <Input
      ref={inputRef}
      value={editValue}
      onChange={(e) => setEditValue(uppercase ? e.target.value.toUpperCase() : e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') { setEditValue(value); setEditing(false); }
      }}
      className="h-7 text-sm"
    />
  );
};

// Click-to-edit select cell
const EditableSelectCell: React.FC<{
  value: string;
  displayValue: string;
  options: { label: string; value: string }[];
  onSave: (value: string) => Promise<void>;
}> = ({ value, displayValue, options, onSave }) => {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div
        className="cursor-pointer px-1 py-0.5 rounded hover:bg-muted"
        onClick={() => setEditing(true)}
      >
        {displayValue}
      </div>
    );
  }

  return (
    <Select
      defaultValue={value}
      onValueChange={async (v) => {
        setEditing(false);
        if (v !== value) {
          try { await onSave(v); } catch { /* reverted by parent */ }
        }
      }}
      open
      onOpenChange={(open) => { if (!open) setEditing(false); }}
    >
      <SelectTrigger className="h-7 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const InputValidationEditor: React.FC<InputValidationEditorProps> = ({ scenario: scenarioProp }) => {
  const [scenario, setScenario] = useState<Scenario>(scenarioProp || (sessionStorage.getItem('selectedScenario') as Scenario) || 'DEFAULT');

  useEffect(() => {
    const handleScenarioChange = () => {
      const newScenario = sessionStorage.getItem('selectedScenario') as Scenario;
      if (newScenario) setScenario(newScenario);
    };
    window.addEventListener('scenarioChanged', handleScenarioChange);
    return () => window.removeEventListener('scenarioChanged', handleScenarioChange);
  }, []);

  useEffect(() => {
    if (scenarioProp) setScenario(scenarioProp);
  }, [scenarioProp]);

  const [inputVariables, setInputVariables] = useState<InputVariable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNewInputForm, setShowNewInputForm] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [newInput, setNewInput] = useState<{
    name: string;
    description: string;
    required: boolean;
    dataType: InputDataType;
    arrayType?: InputDataType;
  }>({
    name: '',
    description: '',
    required: true,
    dataType: 'string'
  });

  const dataTypeOptions = [
    { label: 'String', value: 'string' },
    { label: 'Number', value: 'number' },
    { label: 'Date', value: 'date' },
    { label: 'Boolean', value: 'boolean' },
    { label: 'Array', value: 'array' }
  ];

  const arrayTypeOptions = [
    { label: 'String', value: 'string' },
    { label: 'Number', value: 'number' }
  ];

  useEffect(() => {
    const loadInputVariables = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);

        const inputs = await InputValidationService.getAll(scenario);

        const mappedInputs: InputVariable[] = inputs.map(input => ({
          id: input.id,
          name: input.name,
          description: input.description,
          required: input.required,
          dataType: input.dataType as InputDataType,
          arrayType: input.dataType === 'array' ? 'string' : undefined,
          scenario
        }));

        setInputVariables(mappedInputs);
      } catch (err) {
        console.error('Error loading input validation rules:', err);
        setLoadError('Failed to load input validation data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    loadInputVariables();
  }, [scenario]);

  const addInputVariable = async () => {
    if (!newInput.name) {
      setNotification({ type: 'error', message: 'Input name is required.' });
      return;
    }

    const upperName = newInput.name.toUpperCase();

    if (inputVariables.some(input => input.name.toUpperCase() === upperName)) {
      setNotification({ type: 'error', message: 'An input with this name already exists.' });
      return;
    }

    try {
      const created = await InputValidationService.create({
        name: upperName,
        description: newInput.description,
        required: newInput.required,
        dataType: newInput.dataType as 'string' | 'number' | 'date' | 'array',
        scenario
      });

      const newInputVariable: InputVariable = {
        id: created.id,
        name: created.name,
        description: created.description,
        required: created.required,
        dataType: created.dataType as InputDataType,
        arrayType: created.dataType === 'array' ? newInput.arrayType : undefined,
        scenario
      };

      setInputVariables([...inputVariables, newInputVariable]);
      setShowNewInputForm(false);
      setNotification({ type: 'success', message: 'Input variable added.' });
      setTimeout(() => setNotification(null), 2000);

      setNewInput({
        name: '',
        description: '',
        required: true,
        dataType: 'string'
      });
    } catch (err) {
      console.error('Error creating input variable:', err);
      setNotification({ type: 'error', message: 'Failed to create input variable.' });
    }
  };

  const updateField = async (item: InputVariable, field: string, newValue: any) => {
    const oldItem = { ...item };
    const updatedItem = { ...item, [field]: newValue };

    setInputVariables(vars => vars.map(v => v.id === item.id ? updatedItem : v));

    try {
      await InputValidationService.update({
        id: item.id,
        name: updatedItem.name,
        description: updatedItem.description,
        required: updatedItem.required,
        dataType: updatedItem.dataType as 'string' | 'number' | 'date' | 'array',
        scenario
      });
      setNotification({ type: 'success', message: 'Saved' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error('Error updating input variable:', err);
      setInputVariables(vars => vars.map(v => v.id === item.id ? oldItem : v));
      setNotification({ type: 'error', message: 'Failed to save changes.' });
      throw err;
    }
  };

  const deleteInput = async (id: string) => {
    const itemToDelete = inputVariables.find(v => v.id === id);
    if (!itemToDelete) return;

    setInputVariables(vars => vars.filter(v => v.id !== id));

    try {
      await InputValidationService.delete(id, scenario);
      setNotification({ type: 'success', message: 'Deleted' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error('Error deleting input variable:', err);
      setInputVariables(vars => [...vars, itemToDelete]);
      setNotification({ type: 'error', message: 'Failed to delete.' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <h3 className="text-lg font-medium">Loading input validation data...</h3>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Input Validation - {scenario}</h3>
          <p className="text-sm text-muted-foreground">Click on any cell to edit. Changes save automatically.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowNewInputForm(!showNewInputForm)}
        >
          {showNewInputForm ? <><X className="size-4 mr-1" /> Cancel</> : <><Plus className="size-4 mr-1" /> Add Input Variable</>}
        </Button>
      </div>

      <div>
        <p className="text-sm text-muted-foreground">
          Define the input variables that can be used in the calculation. Each variable must be properly
          defined with a name, type, and whether it is required. These variables will be accessible in the
          calculation using the <code className="bg-muted px-1 rounded">INPUT</code> object (e.g., <code className="bg-muted px-1 rounded">INPUT.KWH</code>).
        </p>
      </div>

      {notification && (
        <Alert variant={notification.type === 'error' ? 'destructive' : 'default'}>
          {notification.type === 'error' && <AlertCircle className="size-4" />}
          <AlertDescription>{notification.message}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="icon" onClick={() => setNotification(null)}>
              <X className="size-4" />
            </Button>
          </AlertAction>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{loadError}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="icon" onClick={() => setLoadError(null)}>
              <X className="size-4" />
            </Button>
          </AlertAction>
        </Alert>
      )}

      {showNewInputForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add New Input Variable</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Variable Name</Label>
                <p className="text-xs text-muted-foreground mb-1">Name of the input variable (will be converted to uppercase)</p>
                <Input
                  value={newInput.name}
                  onChange={(e) => setNewInput({ ...newInput, name: e.target.value })}
                  placeholder="e.g., KWH"
                />
              </div>
              <div>
                <Label>Description</Label>
                <p className="text-xs text-muted-foreground mb-1">Human-readable description of this input variable</p>
                <Input
                  value={newInput.description}
                  onChange={(e) => setNewInput({ ...newInput, description: e.target.value })}
                  placeholder="e.g., Total kilowatt hours"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Data Type</Label>
                <p className="text-xs text-muted-foreground mb-1">Type of this input variable for validation</p>
                <Select
                  value={newInput.dataType}
                  onValueChange={(v) => {
                    const dataType = v as InputDataType;
                    setNewInput({
                      ...newInput,
                      dataType,
                      arrayType: dataType === 'array' ? 'string' : undefined
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dataTypeOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {newInput.dataType === 'array' && (
                <div>
                  <Label>Array Type</Label>
                  <p className="text-xs text-muted-foreground mb-1">Data type of the array elements</p>
                  <Select
                    value={newInput.arrayType || 'string'}
                    onValueChange={(v) => setNewInput({ ...newInput, arrayType: v as InputDataType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {arrayTypeOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="required-checkbox"
                checked={newInput.required}
                onCheckedChange={(checked) => setNewInput({ ...newInput, required: checked === true })}
              />
              <Label htmlFor="required-checkbox">Required Input</Label>
            </div>

            <div>
              <Button onClick={addInputVariable}>Add Input Variable</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[150px]">Variable Name</TableHead>
              <TableHead className="w-[100px]">Required</TableHead>
              <TableHead className="w-[130px]">Data Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {inputVariables.map((item, idx) => (
              <TableRow key={item.id} className={idx % 2 === 1 ? 'bg-muted/50' : ''}>
                <TableCell>
                  <EditableTextCell
                    value={item.name}
                    uppercase
                    onSave={async (v) => {
                      const nameExists = inputVariables.some(
                        input => input.id !== item.id && input.name.toUpperCase() === v.toUpperCase()
                      );
                      if (nameExists) {
                        setNotification({ type: 'error', message: 'An input with this name already exists.' });
                        throw new Error('Duplicate name');
                      }
                      await updateField(item, 'name', v);
                    }}
                  />
                </TableCell>
                <TableCell>
                  <EditableSelectCell
                    value={item.required ? 'Yes' : 'No'}
                    displayValue={item.required ? 'Yes' : 'No'}
                    options={[{ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' }]}
                    onSave={async (v) => updateField(item, 'required', v === 'Yes')}
                  />
                </TableCell>
                <TableCell>
                  <EditableSelectCell
                    value={item.dataType}
                    displayValue={
                      item.dataType === 'array' && item.arrayType
                        ? `Array of ${item.arrayType}s`
                        : item.dataType.charAt(0).toUpperCase() + item.dataType.slice(1)
                    }
                    options={dataTypeOptions}
                    onSave={async (v) => updateField(item, 'dataType', v)}
                  />
                </TableCell>
                <TableCell>
                  <EditableTextCell
                    value={item.description || ''}
                    placeholder="-"
                    onSave={async (v) => updateField(item, 'description', v)}
                  />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => deleteInput(item.id)} className="text-destructive">
                        <Trash2 className="size-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default InputValidationEditor;
