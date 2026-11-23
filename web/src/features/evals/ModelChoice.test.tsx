// web/src/features/evals/ModelChoice.test.tsx
import { render, screen, within } from '@testing-library/react';
import { MODEL_RUNS } from '../../test/dashboardFakes.ts';
import { ModelChoice } from './ModelChoice.tsx';

function rowOf(model: string): HTMLElement {
  const row = screen.getByText(model).closest('tr');
  if (!row) throw new Error(`No row for ${model}`);
  return row;
}

describe('ModelChoice', () => {
  it('one row per model: accuracy, money mistakes, Telugu / Hindi, speed, cost and the gate', () => {
    render(<ModelChoice runs={MODEL_RUNS} />);
    const sarvam = within(rowOf('sarvam-105b'));
    expect(sarvam.getByText('96%')).toBeInTheDocument();
    expect(sarvam.getByText('(22/23)')).toBeInTheDocument();
    expect(sarvam.getByText('0 of 12')).toBeInTheDocument();
    expect(sarvam.getByText('9/9')).toBeInTheDocument();
    expect(sarvam.getByText('2.4 s')).toBeInTheDocument();
    expect(sarvam.getByText('6.1 s')).toBeInTheDocument();
    expect(sarvam.getByText('Passes')).toBeInTheDocument();
    const gemini = within(rowOf('gemini-2.5-flash'));
    expect(gemini.getByText('2 of 12')).toBeInTheDocument();
    expect(gemini.getByText('Fails')).toBeInTheDocument();
    expect(gemini.getByText('1 call(s) got no answer')).toBeInTheDocument();
  });

  it('says how each number is worked out, with each price note once', () => {
    const [first] = MODEL_RUNS;
    if (!first) throw new Error('no fake run');
    const again = { ...first, id: 'model-run-3', metrics: { ...first.metrics, model: 'x' } };
    render(<ModelChoice runs={[...MODEL_RUNS, again]} />);
    expect(screen.getByText(/Typical reply is the middle time/)).toBeInTheDocument();
    const notes = screen.getByText(/with 18% GST/);
    expect(notes.textContent?.match(/Sarvam list price/g)).toHaveLength(1);
    expect(notes).toHaveTextContent('Gemini free tier.');
  });

  it('shows nothing before any bake-off has run', () => {
    const { container } = render(<ModelChoice runs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
