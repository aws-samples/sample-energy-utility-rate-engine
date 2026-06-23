import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Loader2, CheckCircle2, XCircle, Clock, MoreVertical, Trash2, Rocket, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScenarioService } from '../../services/scenario-service';
import { DeploymentService, DeploymentStatus } from '../../services/deployment-service';

interface Scenario {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ScenariosPageProps {
  scenario?: string;
  scenarios?: { label: string; value: string }[];
  onScenariosChange?: (scenarios: { label: string; value: string }[]) => void;
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'SUCCEEDED':
      return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />{status}</Badge>;
    case 'FAILED':
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />{status}</Badge>;
    case 'PENDING':
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />{status}</Badge>;
    default:
      return <Badge variant="outline"><Loader2 className="h-3 w-3 mr-1 animate-spin" />{status}</Badge>;
  }
};

const ScenariosPage: React.FC<ScenariosPageProps> = ({ onScenariosChange }) => {
  const [deploymentTarget, setDeploymentTarget] = useState<string>('');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [newScenarioDescription, setNewScenarioDescription] = useState('');
  const [copyFromScenario, setCopyFromScenario] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingScenario, setDeletingScenario] = useState<Scenario | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showConfirmDeployModal, setShowConfirmDeployModal] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentStatus[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [modifiedScenarios, setModifiedScenarios] = useState<Set<string>>(new Set());

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    const loadScenarios = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const scenarioList = await ScenarioService.getAll();
        setScenarios(scenarioList);
        setHasChanges(false);
        setModifiedScenarios(new Set());
      } catch (err) {
        console.error('Failed to load scenarios:', err);
        setError('Failed to load scenarios. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };
    loadScenarios();
  }, []);

  useEffect(() => {
    if (!deploymentTarget) {
      setDeploymentHistory([]);
      return;
    }
    const loadDeploymentHistory = async () => {
      try {
        setIsLoadingHistory(true);
        const history = await DeploymentService.getByScenario(deploymentTarget);
        setDeploymentHistory(history);
      } catch (err) {
        console.error('Failed to load deployment history:', err);
        setDeploymentHistory([]);
      } finally {
        setIsLoadingHistory(false);
      }
    };
    loadDeploymentHistory();
  }, [deploymentTarget]);

  const startEditing = (item: Scenario, field: 'name' | 'description') => {
    setEditingCell({ id: item.id, field });
    setEditValue(field === 'name' ? item.name : (item.description || ''));
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const item = scenarios.find(s => s.id === id);
    if (!item) { setEditingCell(null); return; }

    const oldValue = field === 'name' ? item.name : (item.description || '');
    if (editValue === oldValue) { setEditingCell(null); return; }

    if (field === 'name') {
      const nameExists = scenarios.some(
        s => s.id !== id && s.name.toUpperCase() === editValue.toUpperCase()
      );
      if (nameExists) {
        setError('A scenario with this name already exists.');
        setEditingCell(null);
        return;
      }
    }

    setScenarios(list =>
      list.map(s => s.id === id ? { ...s, [field]: editValue } : s)
    );
    setModifiedScenarios(prev => new Set(prev).add(id));
    setHasChanges(true);
    setEditingCell(null);
  };

  const saveChanges = async () => {
    try {
      setIsSaving(true);
      setSaveError(null);
      for (const scenarioId of modifiedScenarios) {
        const scenario = scenarios.find(s => s.id === scenarioId);
        if (scenario) {
          await ScenarioService.update({
            id: scenario.id,
            name: scenario.name,
            description: scenario.description || '',
          });
        }
      }
      if (onScenariosChange) {
        onScenariosChange(scenarios.map(s => ({ label: s.name, value: s.id })));
      }
      setHasChanges(false);
      setModifiedScenarios(new Set());
    } catch (err) {
      console.error('Failed to save scenarios:', err);
      setSaveError('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateScenario = async () => {
    if (!newScenarioName.trim()) {
      setCreateError('Scenario name is required');
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      const newScenario = await ScenarioService.create({
        name: newScenarioName.trim(),
        description: newScenarioDescription.trim(),
        copyFrom: copyFromScenario || undefined,
      });
      setScenarios(prev => [...prev, newScenario]);
      if (onScenariosChange) {
        onScenariosChange([...scenarios, newScenario].map(s => ({ label: s.name, value: s.id })));
      }
      setShowCreateModal(false);
      setNewScenarioName('');
      setNewScenarioDescription('');
      setCopyFromScenario('');
    } catch (err) {
      console.error('Failed to create scenario:', err);
      setCreateError(err instanceof Error ? err.message : 'Failed to create scenario');
    } finally {
      setIsCreating(false);
    }
  };

  const openDeleteModal = (scenario: Scenario) => {
    setDeletingScenario(scenario);
    setDeleteError(null);
    setShowDeleteModal(true);
  };

  const handleDeleteScenario = async () => {
    if (!deletingScenario) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await ScenarioService.delete(deletingScenario.id);
      setScenarios(prev => prev.filter(s => s.id !== deletingScenario.id));
      if (onScenariosChange) {
        onScenariosChange(
          scenarios.filter(s => s.id !== deletingScenario.id).map(s => ({ label: s.name, value: s.id }))
        );
      }
      setShowDeleteModal(false);
      setDeletingScenario(null);
    } catch (err) {
      console.error('Failed to delete scenario:', err);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete scenario');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeploy = async () => {
    if (!deploymentTarget) {
      setDeployError('Please select a scenario to deploy using the radio buttons');
      setShowDeployModal(true);
      return;
    }
    setIsDeploying(true);
    setDeployError(null);
    setShowDeployModal(true);
    try {
      const response = await DeploymentService.deploy(deploymentTarget);
      const initialStatus: DeploymentStatus = {
        deploymentId: response.deploymentId,
        scenario: response.scenario,
        status: response.status as DeploymentStatus['status'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setDeploymentStatus(initialStatus);
      setDeploymentHistory(prev => [initialStatus, ...prev]);
      // Poll every 5s for up to 30 min. A cold CodeBuild run (installs the Rust
      // toolchain and compiles all dependencies from scratch) can take ~7 min, and
      // the backend deployment state machine allows up to 45 min — so the UI must
      // wait well past the old 5-min window to avoid reporting a false timeout on a
      // deployment that actually succeeds.
      const finalStatus = await DeploymentService.pollStatus(
        response.deploymentId,
        (status) => {
          setDeploymentStatus(status);
          setDeploymentHistory(prev =>
            prev.map(d => d.deploymentId === status.deploymentId ? status : d)
          );
        },
        5000,
        360
      );
      setDeploymentHistory(prev =>
        prev.map(d => d.deploymentId === finalStatus.deploymentId ? finalStatus : d)
      );
    } catch (err) {
      console.error('Deployment failed:', err);
      setDeployError(err instanceof Error ? err.message : 'Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  };

  const getDeploymentProgress = (): number => {
    if (!deploymentStatus) return 0;
    switch (deploymentStatus.status) {
      case 'PENDING': return 10;
      case 'GENERATING': return 30;
      case 'BUILDING': return 60;
      case 'DEPLOYING': return 85;
      case 'SUCCEEDED': return 100;
      case 'FAILED': return 100;
      default: return 0;
    }
  };

  const getProgressDescription = (): string => {
    if (!deploymentStatus) return '';
    switch (deploymentStatus.status) {
      case 'PENDING': return 'Preparing deployment...';
      case 'GENERATING': return 'Generating Rust code from RDL...';
      case 'BUILDING': return 'Compiling Rust code...';
      case 'DEPLOYING': return 'Deploying Lambda function...';
      case 'SUCCEEDED': return 'Deployment complete!';
      default: return 'Deployment failed';
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p>Loading scenarios...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between">
            {error}
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>✕</Button>
          </AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertTitle>Error saving changes</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            {saveError}
            <Button variant="ghost" size="sm" onClick={() => setSaveError(null)}>✕</Button>
          </AlertDescription>
        </Alert>
      )}

      {hasChanges && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            You have unsaved changes. Click "Save Changes" to persist your modifications.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Rate Scenarios</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Click on any cell to edit. Click Save Changes to persist modifications.
              </p>
            </div>
            <div className="flex flex-row gap-2">
              <Button variant="outline" onClick={() => setShowCreateModal(true)}>
                Create Scenario
              </Button>
              <Button
                variant="outline"
                onClick={saveChanges}
                disabled={!hasChanges || isSaving}
              >
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button
                onClick={() => setShowConfirmDeployModal(true)}
                disabled={!deploymentTarget || isDeploying}
              >
                {isDeploying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Rocket className="h-4 w-4 mr-2" />
                Deploy {deploymentTarget || 'Scenario'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {scenarios.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">No scenarios found.</p>
              <Button onClick={() => setShowCreateModal(true)}>Create scenario</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Deploy</TableHead>
                  <TableHead className="w-[200px]">Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {scenarios.map((item, i) => (
                  <TableRow key={item.id} className={cn(i % 2 === 1 && 'bg-muted/50')}>
                    <TableCell>
                      <input
                        type="radio"
                        name="deploymentTarget"
                        checked={deploymentTarget === item.id}
                        onChange={() => setDeploymentTarget(item.id)}
                        className="cursor-pointer w-4 h-4"
                      />
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => !(editingCell?.id === item.id && editingCell?.field === 'name') && startEditing(item, 'name')}
                    >
                      {editingCell?.id === item.id && editingCell?.field === 'name' ? (
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCell(null); }}
                          className="h-7"
                        />
                      ) : (
                        item.name
                      )}
                    </TableCell>
                    <TableCell
                      className="cursor-pointer"
                      onClick={() => !(editingCell?.id === item.id && editingCell?.field === 'description') && startEditing(item, 'description')}
                    >
                      {editingCell?.id === item.id && editingCell?.field === 'description' ? (
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCell(null); }}
                          className="h-7"
                        />
                      ) : (
                        item.description || <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={item.id === 'DEFAULT'}
                            onClick={() => openDeleteModal(item)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Deployment History */}
      {deploymentTarget && (
        <Card>
          <CardHeader>
            <CardTitle>Deployment History</CardTitle>
            <p className="text-sm text-muted-foreground">Deployment history for {deploymentTarget}</p>
          </CardHeader>
          <CardContent>
            {isLoadingHistory ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : deploymentHistory.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">
                No deployments found for this scenario.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-[280px]">Deployment ID</TableHead>
                    <TableHead className="w-[180px]">Created</TableHead>
                    <TableHead className="w-[180px]">Updated</TableHead>
                    <TableHead>Lambda ARN</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deploymentHistory.map((item, i) => (
                    <TableRow key={item.deploymentId} className={cn(i % 2 === 1 && 'bg-muted/50')}>
                      <TableCell><StatusBadge status={item.status} /></TableCell>
                      <TableCell><code className="text-xs">{item.deploymentId}</code></TableCell>
                      <TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell>
                      <TableCell>{new Date(item.updatedAt).toLocaleString()}</TableCell>
                      <TableCell>
                        {item.lambdaArn ? <code className="text-xs">{item.lambdaArn.split(':').pop()}</code> : '-'}
                      </TableCell>
                      <TableCell>{item.error || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirm Deploy Dialog */}
      <Dialog open={showConfirmDeployModal} onOpenChange={setShowConfirmDeployModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deployment</DialogTitle>
          </DialogHeader>
          <div>
            <p>Are you sure you want to deploy scenario <b>{deploymentTarget}</b>?</p>
            <p className="text-sm text-muted-foreground mt-2">
              This will compile the RDL code and deploy a new Lambda function version.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDeployModal(false)}>Cancel</Button>
            <Button onClick={() => { setShowConfirmDeployModal(false); handleDeploy(); }}>Deploy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Scenario Dialog */}
      <Dialog
        open={showCreateModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateModal(false);
            setNewScenarioName('');
            setNewScenarioDescription('');
            setCopyFromScenario('');
            setCreateError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Scenario</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-6">
            {createError && (
              <Alert variant="destructive">
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label>Scenario Name</Label>
              <p className="text-sm text-muted-foreground">A unique name for the scenario</p>
              <Input
                value={newScenarioName}
                onChange={e => setNewScenarioName(e.target.value)}
                placeholder="e.g., PROPOSED_2025"
                disabled={isCreating}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Description</Label>
              <p className="text-sm text-muted-foreground">Optional description of the scenario</p>
              <Textarea
                value={newScenarioDescription}
                onChange={e => setNewScenarioDescription(e.target.value)}
                placeholder="e.g., Proposed rate changes for 2025"
                disabled={isCreating}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Copy Data From</Label>
              <p className="text-sm text-muted-foreground">
                Optionally copy calculations, input validations, and factors from an existing scenario
              </p>
              <Select value={copyFromScenario} onValueChange={setCopyFromScenario} disabled={isCreating}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a scenario to copy from (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {scenarios.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={handleCreateScenario} disabled={isCreating || !newScenarioName.trim()}>
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Scenario Dialog */}
      <Dialog
        open={showDeleteModal}
        onOpenChange={(open) => {
          if (!open) { setShowDeleteModal(false); setDeletingScenario(null); setDeleteError(null); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Scenario</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {deleteError && (
              <Alert variant="destructive">
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}
            <p>Are you sure you want to delete scenario <b>{deletingScenario?.name}</b>?</p>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This action cannot be undone. All RDL code and data associated with this scenario will be permanently deleted.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteScenario} disabled={isDeleting}>
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deployment Status Dialog */}
      <Dialog open={showDeployModal} onOpenChange={setShowDeployModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deployment Status</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {deployError && (
              <Alert variant="destructive">
                <AlertDescription>{deployError}</AlertDescription>
              </Alert>
            )}
            {deploymentStatus && (
              <>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Scenario</p>
                  <p>{deploymentStatus.scenario}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <StatusBadge status={deploymentStatus.status} />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Progress</p>
                  <Progress
                    value={getDeploymentProgress()}
                    className={cn(deploymentStatus.status === 'FAILED' && '[&>div]:bg-destructive')}
                  />
                  <p className="text-sm text-muted-foreground mt-1">{getProgressDescription()}</p>
                </div>
                {deploymentStatus.lambdaArn && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Lambda ARN</p>
                    <code className="text-sm">{deploymentStatus.lambdaArn}</code>
                  </div>
                )}
                {deploymentStatus.error && (
                  <Alert variant="destructive">
                    <AlertTitle>Error Details</AlertTitle>
                    <AlertDescription>{deploymentStatus.error}</AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowDeployModal(false)} disabled={isDeploying}>
              {deploymentStatus?.status === 'SUCCEEDED' || deploymentStatus?.status === 'FAILED' ? 'Close' : 'Running...'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ScenariosPage;
