import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '@/components/ErrorBoundary';

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('renders healthy children', () => {
    render(<ErrorBoundary><p>Menu is ready</p></ErrorBoundary>);
    expect(screen.getByText('Menu is ready')).toBeInTheDocument();
  });

  it('provides recovery and duplicate-order guidance after a render failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const BrokenPage = () => { throw new Error('chunk/render failed'); };
    render(<ErrorBoundary><BrokenPage /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('check your recent orders');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });
});
