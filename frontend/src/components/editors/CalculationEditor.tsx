import React, { useEffect, useState, useRef } from 'react';
import { Scenario as ScenarioType } from '../../types/updatedRates';
import { validateRDLCode, getIndentationLevel } from '../../utils/rdlValidator';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { RdlService, RdlLine } from '../../services/rdl-service';
import { generateUniqueId as genId } from '../../types/updatedRates';
import Editor from '@monaco-editor/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Loader2, Upload, ChevronDown, ChevronRight, ChevronsUpDown,
  Plus, FolderPlus, MoreHorizontal, ArrowUp, ArrowDown,
  Trash2, AlertCircle, AlertTriangle, Info, XCircle, X,
} from 'lucide-react';

interface CalculationEditorProps {
  scenario?: ScenarioType;
}

interface RdlGroup {
  id: string;
  name: string;
  order: number;
  children: RdlLine[];
  isGroup: true;
}

type DisplayItem = RdlLine | RdlGroup;

const CalculationEditor: React.FC<CalculationEditorProps> = ({ scenario: scenarioProp }) => {
  const [scenario, setScenario] = useState<ScenarioType>(scenarioProp || (sessionStorage.getItem('selectedScenario') as ScenarioType) || 'DEFAULT');

  useEffect(() => {
    const handleScenarioChange = () => {
      const newScenario = sessionStorage.getItem('selectedScenario') as ScenarioType;
      if (newScenario) setScenario(newScenario);
    };
    window.addEventListener('scenarioChanged', handleScenarioChange);
    return () => window.removeEventListener('scenarioChanged', handleScenarioChange);
  }, []);

  useEffect(() => {
    if (scenarioProp) setScenario(scenarioProp);
  }, [scenarioProp]);

  const { authStatus } = useAuthenticator(context => [context.authStatus]);
  const hasWriteAccess = authStatus === 'authenticated';

  const [rdlLines, setRdlLines] = useState<RdlLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{[id: string]: string}>({});
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [lineToDelete, setLineToDelete] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | 'all'>(new Set());
  const [editorMode, setEditorMode] = useState<'grid' | 'code'>('grid');
  const [codeEditorValue, setCodeEditorValue] = useState<string>('');
  const [editorHeight, setEditorHeight] = useState(600);
  const [editingCell, setEditingCell] = useState<{ id: string; value: string } | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const calculateHeight = () => {
      if (editorContainerRef.current) {
        const rect = editorContainerRef.current.getBoundingClientRect();
        setEditorHeight(Math.max(400, window.innerHeight - rect.top - 40));
      }
    };
    calculateHeight();
    window.addEventListener('resize', calculateHeight);
    return () => window.removeEventListener('resize', calculateHeight);
  }, [editorMode]);

  const linesToCode = (lines: RdlLine[]): string => {
    return lines.sort((a, b) => a.order - b.order).map(line => line.code).join('\n');
  };

  const codeToLines = (code: string): RdlLine[] => {
    return code.split('\n').map((line, index) => ({
      id: rdlLines[index]?.id || genId(),
      order: index + 1,
      code: line,
    }));
  };

  useEffect(() => {
    const loadRdlLines = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const lines = await RdlService.getAll(scenario);
        const sortedLines = [...lines].sort((a, b) => a.order - b.order);
        setRdlLines(sortedLines);
        setCodeEditorValue(linesToCode(sortedLines));
        setHasChanges(false);
        setExpandedGroups('all');
        const errors: {[id: string]: string} = {};
        sortedLines.forEach(line => {
          const validation = validateRDLCode(line.code);
          if (!validation.valid && validation.message) errors[line.id] = validation.message;
        });
        setValidationErrors(errors);
      } catch (err) {
        console.error('Error loading RDL lines:', err);
        setLoadError('Failed to load calculation data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };
    loadRdlLines();
  }, [scenario]);

  const parseLinesToGroups = (lines: RdlLine[]): DisplayItem[] => {
    const sortedLines = [...lines].sort((a, b) => a.order - b.order);
    const displayItems: DisplayItem[] = [];
    let currentGroup: RdlGroup | null = null;
    for (const line of sortedLines) {
      const trimmedCode = line.code.trim();
      if (trimmedCode.startsWith('///')) {
        if (currentGroup && currentGroup.children.length > 0) displayItems.push(currentGroup);
        currentGroup = {
          id: line.id,
          name: trimmedCode.substring(3).trim() || 'Unnamed Group',
          order: line.order,
          children: [],
          isGroup: true,
        };
      } else {
        if (currentGroup) currentGroup.children.push(line);
        else displayItems.push(line);
      }
    }
    if (currentGroup && currentGroup.children.length > 0) displayItems.push(currentGroup);
    return displayItems;
  };

  const isGroup = (item: DisplayItem): item is RdlGroup => {
    return 'isGroup' in item && item.isGroup === true;
  };

  const isGroupExpanded = (groupId: string) => {
    return expandedGroups === 'all' || (expandedGroups instanceof Set && expandedGroups.has(groupId));
  };

  const toggleGroup = (groupId: string) => {
    if (expandedGroups === 'all') {
      const allGroupIds = parseLinesToGroups(rdlLines).filter(i => isGroup(i)).map(i => i.id);
      const newSet = new Set(allGroupIds);
      newSet.delete(groupId);
      setExpandedGroups(newSet);
    } else {
      setExpandedGroups(prev => {
        const newSet = new Set(prev as Set<string>);
        if (newSet.has(groupId)) newSet.delete(groupId);
        else newSet.add(groupId);
        return newSet;
      });
    }
  };

  const addRdlLine = () => {
    const nextOrder = rdlLines.length > 0 ? Math.max(...rdlLines.map(l => l.order)) + 1 : 1;
    setRdlLines([...rdlLines, { id: genId(), code: '// New RDL line', order: nextOrder }]);
    setHasChanges(true);
  };

  const addGroup = () => {
    const nextOrder = rdlLines.length > 0 ? Math.max(...rdlLines.map(l => l.order)) + 1 : 1;
    setRdlLines([...rdlLines, { id: genId(), code: '///New Group', order: nextOrder }]);
    setHasChanges(true);
  };

  const addLineAbove = (lineId: string) => {
    const lineIndex = rdlLines.findIndex(l => l.id === lineId);
    if (lineIndex === -1) return;
    const targetOrder = rdlLines[lineIndex].order;
    const updatedLines = rdlLines.map(l => l.order >= targetOrder ? { ...l, order: l.order + 1 } : l);
    setRdlLines([...updatedLines, { id: genId(), code: '// New RDL line', order: targetOrder }].sort((a, b) => a.order - b.order));
    setHasChanges(true);
  };

  const addLineBelow = (lineId: string) => {
    const lineIndex = rdlLines.findIndex(l => l.id === lineId);
    if (lineIndex === -1) return;
    const targetOrder = rdlLines[lineIndex].order + 1;
    const updatedLines = rdlLines.map(l => l.order >= targetOrder ? { ...l, order: l.order + 1 } : l);
    setRdlLines([...updatedLines, { id: genId(), code: '// New RDL line', order: targetOrder }].sort((a, b) => a.order - b.order));
    setHasChanges(true);
  };

  const moveLineUp = (lineId: string) => {
    const lineIndex = rdlLines.findIndex(l => l.id === lineId);
    if (lineIndex <= 0) return;
    const line = rdlLines[lineIndex];
    const prevLine = rdlLines[lineIndex - 1];
    setRdlLines(rdlLines.map(l => {
      if (l.id === line.id) return { ...l, order: prevLine.order };
      if (l.id === prevLine.id) return { ...l, order: line.order };
      return l;
    }).sort((a, b) => a.order - b.order));
    setHasChanges(true);
  };

  const moveLineDown = (lineId: string) => {
    const lineIndex = rdlLines.findIndex(l => l.id === lineId);
    if (lineIndex === -1 || lineIndex === rdlLines.length - 1) return;
    const line = rdlLines[lineIndex];
    const nextLine = rdlLines[lineIndex + 1];
    setRdlLines(rdlLines.map(l => {
      if (l.id === line.id) return { ...l, order: nextLine.order };
      if (l.id === nextLine.id) return { ...l, order: line.order };
      return l;
    }).sort((a, b) => a.order - b.order));
    setHasChanges(true);
  };

  const deleteLine = (lineId: string) => {
    setLineToDelete(lineId);
    setIsDeleteModalVisible(true);
  };

  const confirmDeleteLine = () => {
    if (!lineToDelete) return;
    const lineToDeleteOrder = rdlLines.find(l => l.id === lineToDelete)?.order;
    if (!lineToDeleteOrder) return;
    let updatedLines = rdlLines.filter(l => l.id !== lineToDelete);
    updatedLines = updatedLines.map(l => l.order > lineToDeleteOrder ? { ...l, order: l.order - 1 } : l);
    setRdlLines(updatedLines);
    setLineToDelete(null);
    setIsDeleteModalVisible(false);
    setHasChanges(true);
  };

  const commitEdit = (lineId: string, newValue: string) => {
    const newStringValue = newValue.replace(/\n/g, '');
    const targetLine = rdlLines.find(l => l.id === lineId);
    if (!targetLine || newStringValue === targetLine.code) {
      setEditingCell(null);
      return;
    }
    const validation = validateRDLCode(newStringValue);
    if (!validation.valid && validation.message) {
      setValidationErrors(prev => ({ ...prev, [lineId]: validation.message! }));
    } else {
      setValidationErrors(prev => {
        const next = { ...prev };
        delete next[lineId];
        return next;
      });
    }
    setRdlLines(lines => lines.map(l => l.id === lineId ? { ...l, code: newStringValue } : l));
    setEditingCell(null);
    setHasChanges(true);
  };

  const handleEditorModeChange = (mode: 'grid' | 'code') => {
    if (mode === 'code') {
      setCodeEditorValue(linesToCode(rdlLines));
    } else {
      const newLines = codeToLines(codeEditorValue);
      setRdlLines(newLines);
      const errors: {[id: string]: string} = {};
      newLines.forEach(line => {
        const validation = validateRDLCode(line.code);
        if (!validation.valid && validation.message) errors[line.id] = validation.message;
      });
      setValidationErrors(errors);
    }
    setEditorMode(mode);
  };

  const handleCodeEditorChange = (value: string | undefined) => {
    setCodeEditorValue(value ?? '');
    setHasChanges(true);
  };

  const saveChanges = async () => {
    let linesToSave = rdlLines;
    if (editorMode === 'code') {
      linesToSave = codeToLines(codeEditorValue);
      setRdlLines(linesToSave);
    }
    try {
      const errors: {[id: string]: string} = {};
      let hasError = false;
      linesToSave.forEach(line => {
        const validation = validateRDLCode(line.code);
        if (!validation.valid && validation.message) {
          errors[line.id] = validation.message;
          hasError = true;
        }
      });
      setValidationErrors(errors);
      if (hasError) {
        setSaveError('Cannot save due to validation errors. Please fix the highlighted issues first.');
        return;
      }
      setIsSaving(true);
      setSaveError(null);
      await RdlService.save({ scenario, lines: linesToSave });
      setHasChanges(false);
    } catch (err) {
      console.error('Error saving RDL lines:', err);
      setSaveError('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderCode = (line: RdlLine, lineIndex: number) => {
    const codeStrings = rdlLines.map(l => l.code);
    const indentLevel = getIndentationLevel(codeStrings, lineIndex);
    const padding = ' '.repeat(indentLevel * 2);
    return (
      <span className={cn('font-mono whitespace-pre-wrap break-words', validationErrors[line.id] && 'text-destructive')}>
        {padding}{line.code.replace(/;/g, '')}
      </span>
    );
  };

  const displayItems = parseLinesToGroups(rdlLines);
  const isDark = localStorage.getItem('theme') === 'dark';


  const renderChildRow = (child: RdlLine) => {
    const lineIndex = rdlLines.findIndex(l => l.id === child.id);
    const isEditing = editingCell?.id === child.id;
    return (
      <TableRow key={child.id} className="even:bg-muted/20">
        <TableCell className="text-center text-muted-foreground">{child.order}</TableCell>
        <TableCell
          className="cursor-pointer"
          onClick={() => hasWriteAccess && !isEditing && setEditingCell({ id: child.id, value: child.code })}
        >
          {isEditing ? (
            <Input
              autoFocus
              value={editingCell.value}
              onChange={(e) => setEditingCell({ id: child.id, value: e.target.value })}
              onBlur={() => commitEdit(child.id, editingCell.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit(child.id, editingCell.value);
                if (e.key === 'Escape') setEditingCell(null);
              }}
              className="font-mono text-sm"
            />
          ) : (
            <div className="flex items-center gap-2">
              {renderCode(child, lineIndex)}
              {validationErrors[child.id] && (
                <Popover>
                  <PopoverTrigger>
                    <Badge variant="destructive" className="cursor-pointer"><AlertCircle className="size-3" /></Badge>
                  </PopoverTrigger>
                  <PopoverContent className="text-sm">{validationErrors[child.id]}</PopoverContent>
                </Popover>
              )}
            </div>
          )}
        </TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs"><MoreHorizontal className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => moveLineUp(child.id)} disabled={child.order === 1}>
                <ArrowUp className="size-4" /> Move Up
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => moveLineDown(child.id)} disabled={child.order === rdlLines.length}>
                <ArrowDown className="size-4" /> Move Down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => addLineAbove(child.id)}>
                <Plus className="size-4" /> Add Above
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addLineBelow(child.id)}>
                <Plus className="size-4" /> Add Below
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => deleteLine(child.id)}>
                <Trash2 className="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Loader2 className="animate-spin size-8 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Loading calculation data...</h3>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Calculation Definition - {scenario}</h2>
          <p className="text-sm text-muted-foreground">
            {editorMode === 'grid'
              ? 'Click on any cell to edit. Click Save Changes to persist modifications.'
              : 'Edit code directly. Use comments on separate lines for descriptions.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={editorMode === 'code'}
              onCheckedChange={(checked) => handleEditorModeChange(checked ? 'code' : 'grid')}
            />
            <Label className="text-sm">Code Editor</Label>
          </div>
          {editorMode === 'grid' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (expandedGroups === 'all' || (expandedGroups instanceof Set && expandedGroups.size > 0)) {
                    setExpandedGroups(new Set());
                  } else {
                    setExpandedGroups('all');
                  }
                }}
              >
                <ChevronsUpDown className="size-4" />
                {expandedGroups === 'all' || (expandedGroups instanceof Set && expandedGroups.size > 0) ? 'Collapse All' : 'Expand All'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={!hasWriteAccess || isSaving}>
                    <Plus className="size-4" /> Add <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={addRdlLine}>
                    <Plus className="size-4" /> Add Line
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={addGroup}>
                    <FolderPlus className="size-4" /> Add Group
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <Button onClick={saveChanges} disabled={!hasChanges || !hasWriteAccess || isSaving}>
            {isSaving ? <Loader2 className="animate-spin size-4" /> : <Upload className="size-4" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* RDL Quick Reference */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 px-0 font-semibold">
            <ChevronRight className="size-4 transition-transform [[data-state=open]_&]:rotate-90" />
            RDL Quick Reference
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-4 pt-2 text-sm">
            <div>
              <h4 className="font-semibold mb-1">Basics</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="bg-muted px-1 rounded text-xs">variable = expression</code> Assign a value to a variable</li>
                <li><code className="bg-muted px-1 rounded text-xs">///Section Name</code> Create collapsible groups in the editor</li>
                <li><code className="bg-muted px-1 rounded text-xs">// comment</code> Add notes (ignored in calculations)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-1">Input Values</h4>
              <p className="text-muted-foreground mb-1">Access data from the calculation request using INPUT.FIELDNAME:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="bg-muted px-1 rounded text-xs">INPUT.RATE</code> Rate code (e.g., "RES", "COM")</li>
                <li><code className="bg-muted px-1 rounded text-xs">INPUT.KWH</code> Total kilowatt hours consumed</li>
                <li><code className="bg-muted px-1 rounded text-xs">INPUT.KWD</code> Kilowatt demand (peak usage)</li>
                <li><code className="bg-muted px-1 rounded text-xs">INPUT.BILL_DATE</code> Billing date for rate lookups</li>
                <li><code className="bg-muted px-1 rounded text-xs">INPUT.TAX_CLASS</code> Tax classification code</li>
                <li><code className="bg-muted px-1 rounded text-xs">INPUT.RIDERS</code> Array of applied rider codes</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-1">Lookup Function</h4>
              <p className="text-muted-foreground mb-1">Retrieve rate factors from the data store:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="bg-muted px-1 rounded text-xs">GET_FACTOR(key1, key2, key3, key4, key5, date)</code> Lookup a factor using 1-5 keys. Use empty strings for unused keys.</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-1">Output</h4>
              <p className="text-muted-foreground mb-1">The calculation returns line items (output), errors, and debug info:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="bg-muted px-1 rounded text-xs">OUTPUT.INSERT("name", value)</code> Add a line item to calculation results</li>
                <li><code className="bg-muted px-1 rounded text-xs">ERROR.ADD("message")</code> Log an error message</li>
                <li><code className="bg-muted px-1 rounded text-xs">DEBUG.INSERT("key", value)</code> Log debug info for testing</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-1">Conditionals</h4>
              <p className="text-muted-foreground mb-1">Execute different code based on conditions:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="bg-muted px-1 rounded text-xs">IF condition</code> / <code className="bg-muted px-1 rounded text-xs">ELSEIF condition</code> / <code className="bg-muted px-1 rounded text-xs">ELSE</code> / <code className="bg-muted px-1 rounded text-xs">ENDIF</code></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-1">Loops</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="bg-muted px-1 rounded text-xs">FOR item IN collection</code> / <code className="bg-muted px-1 rounded text-xs">ENDFOR</code></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-1">Arrays</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="bg-muted px-1 rounded text-xs">mylist = ["a", "b", "c"]</code> Create an array</li>
                <li><code className="bg-muted px-1 rounded text-xs">IF "value" IN mylist</code> Check membership</li>
              </ul>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Alerts */}
      {loadError && (
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertTitle>Error loading data</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            {loadError}
            <Button variant="ghost" size="icon-xs" onClick={() => setLoadError(null)}><X className="size-3" /></Button>
          </AlertDescription>
        </Alert>
      )}
      {saveError && (
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertTitle>Error saving changes</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            {saveError}
            <Button variant="ghost" size="icon-xs" onClick={() => setSaveError(null)}><X className="size-3" /></Button>
          </AlertDescription>
        </Alert>
      )}
      {Object.keys(validationErrors).length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Validation errors in your RDL code</AlertTitle>
          <AlertDescription>Please fix the highlighted lines before saving.</AlertDescription>
        </Alert>
      )}
      {hasChanges && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>You have unsaved changes. Click "Save Changes" to persist your modifications.</AlertDescription>
        </Alert>
      )}
      {!hasWriteAccess && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Read-only mode</AlertTitle>
          <AlertDescription>You are viewing this content in read-only mode. Contact an administrator if you need edit access.</AlertDescription>
        </Alert>
      )}

      {/* Editor */}
      {editorMode === 'code' ? (
        <div ref={editorContainerRef}>
          <Editor
            height={editorHeight}
            language="plaintext"
            theme={isDark ? 'vs-dark' : 'light'}
            value={codeEditorValue}
            onChange={handleCodeEditorChange}
            options={{ wordWrap: 'on', minimap: { enabled: false }, fontSize: 14 }}
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px] text-center">Order</TableHead>
              <TableHead>RDL Code</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayItems.map(item => {
              if (isGroup(item)) {
                const expanded = isGroupExpanded(item.id);
                return (
                  <React.Fragment key={item.id}>
                    <TableRow className="bg-muted/30">
                      <TableCell />
                      <TableCell>
                        <button
                          className="flex items-center gap-2 font-semibold text-sm w-full text-left"
                          onClick={() => toggleGroup(item.id)}
                        >
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          {item.name} ({item.children.length} lines)
                        </button>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs"><MoreHorizontal className="size-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => {
                              const lastChild = item.children[item.children.length - 1];
                              if (lastChild) addLineBelow(lastChild.id);
                            }}>
                              <Plus className="size-4" /> Add Line to Group
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => deleteLine(item.id)}>
                              <Trash2 className="size-4" /> Delete Group
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {expanded && item.children.map(child => renderChildRow(child))}
                  </React.Fragment>
                );
              }
              return renderChildRow(item);
            })}
          </TableBody>
        </Table>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteModalVisible} onOpenChange={setIsDeleteModalVisible}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
          </DialogHeader>
          <p className="text-sm">Are you sure you want to delete this line? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteModalVisible(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteLine}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CalculationEditor;
