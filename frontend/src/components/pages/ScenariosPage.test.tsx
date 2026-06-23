import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ScenariosPage from './ScenariosPage';

vi.mock('../../services/scenario-service', () => ({
  ScenarioService: {
    getAll: vi.fn().mockResolvedValue([
      { id: 'DEFAULT', name: 'DEFAULT', description: 'Default scenario', createdAt: '2025-01-01', updatedAt: '2025-01-01' },
    ]),
  },
}));

vi.mock('../../services/deployment-service', () => ({
  DeploymentService: {
    getByScenario: vi.fn().mockResolvedValue([]),
    deploy: vi.fn(),
    pollStatus: vi.fn(),
  },
}));

describe('ScenariosPage', () => {
  it('renders loading state initially', () => {
    render(<ScenariosPage />);
    expect(screen.getByText('Loading scenarios...')).toBeInTheDocument();
  });

  it('renders scenario table after loading', async () => {
    render(<ScenariosPage />);
    await waitFor(() => {
      expect(screen.getByText('Rate Scenarios')).toBeInTheDocument();
    });
    expect(screen.getByText('DEFAULT')).toBeInTheDocument();
  });
});
