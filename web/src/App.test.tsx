// web/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the project title', () => {
    // Arrange + Act
    render(<App />);
    // Assert
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Voice Collections');
  });

  it('lists English and Hindi as supported languages', () => {
    render(<App />);
    const items = screen.getAllByRole('listitem').map(getText);
    expect(items).toEqual(['en', 'hi']);
  });
});

function getText(element: HTMLElement): string {
  return element.textContent ?? '';
}
