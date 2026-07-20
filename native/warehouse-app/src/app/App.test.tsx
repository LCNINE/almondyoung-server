import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App shell', () => {
  it('renders the app title', () => {
    render(<App />);
    expect(screen.getByText('Almond WMS')).toBeInTheDocument();
  });
});
