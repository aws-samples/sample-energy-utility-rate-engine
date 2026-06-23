import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CustomFunctionsPage from './CustomFunctionsPage';

vi.mock('../../services/custom-functions-service', () => ({
  CustomFunctionsService: {
    getAll: vi.fn().mockResolvedValue([]),
  },
}));

describe('CustomFunctionsPage', () => {
  it('renders loading state initially', () => {
    render(<CustomFunctionsPage />);
    expect(screen.getByText('Loading custom functions...')).toBeInTheDocument();
  });

  it('renders content after loading', async () => {
    render(<CustomFunctionsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Custom functions extend/)).toBeInTheDocument();
    });
  });
});
