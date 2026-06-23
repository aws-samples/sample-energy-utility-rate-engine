import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EditableCell from './EditableCell';

describe('EditableCell', () => {
  it('renders display value', () => {
    render(<EditableCell value="hello" onChange={vi.fn()} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders placeholder when value is empty', () => {
    render(<EditableCell value="" onChange={vi.fn()} placeholder="Enter value" />);
    expect(screen.getByText('Enter value')).toBeInTheDocument();
  });

  it('enters edit mode on double-click', () => {
    render(<EditableCell value="hello" onChange={vi.fn()} />);
    fireEvent.doubleClick(screen.getByText('hello'));
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
  });

  it('does not enter edit mode when disabled', () => {
    render(<EditableCell value="hello" onChange={vi.fn()} disabled />);
    fireEvent.doubleClick(screen.getByText('hello'));
    expect(screen.queryByDisplayValue('hello')).not.toBeInTheDocument();
  });
});
