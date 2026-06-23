import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import SiteHeader from './TopNavigation';
import { SidebarProvider } from '@/components/ui/sidebar';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const defaultProps = {
  pageName: 'Scenarios',
  theme: 'light' as const,
  onThemeToggle: vi.fn(),
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SidebarProvider>{children}</SidebarProvider>
);

describe('SiteHeader', () => {
  it('renders the current page name', () => {
    render(<SiteHeader {...defaultProps} />, { wrapper });
    expect(screen.getByText('Scenarios')).toBeInTheDocument();
  });

  it('renders the scenario dropdown with selected label', () => {
    render(
      <SiteHeader
        {...defaultProps}
        scenarios={[{ label: 'DEFAULT', value: 'DEFAULT' }]}
        selectedScenario="DEFAULT"
      />,
      { wrapper }
    );
    expect(screen.getByText(/Scenario:.*DEFAULT/)).toBeInTheDocument();
  });

  it('renders theme toggle button', () => {
    render(<SiteHeader {...defaultProps} />, { wrapper });
    expect(screen.getByText('Toggle theme')).toBeInTheDocument();
  });
});
