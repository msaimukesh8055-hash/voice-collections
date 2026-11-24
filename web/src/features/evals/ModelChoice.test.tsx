// web/src/features/evals/ModelChoice.test.tsx
// The simpler model choice (Saim, 2026-11-24): the answer first, one card per model with four
// big numbers, "Safe on its own?" with reasons in words, identical variants as one line, and how
// it was tested in a fold.
import { render, screen, within } from '@testing-library/react';
import type { ModelRun } from '../../lib/modelChoiceSchemas.ts';
import { MODEL_RUNS } from '../../test/dashboardFakes.ts';
import { headline, ModelChoice, splitTwins } from './ModelChoice.tsx';

function cardOf(model: string): HTMLElement {
  return screen.getByRole('article', { name: model });
}

function first(): ModelRun {
  const [run] = MODEL_RUNS;
  if (!run) throw new Error('no fake run');
  return run;
}

describe('ModelChoice', () => {
  it('says the answer first, in one line', () => {
    render(<ModelChoice runs={MODEL_RUNS} />);
    expect(
      screen.getByText(
        '✅ Using sarvam-105b. Most accurate (96%), ₹14.16 per 1,000 messages. Gemini is the backup if Sarvam fails.',
      ),
    ).toBeInTheDocument();
  });

  it('says how many times faster only when the gap is worth it', () => {
    const slow = MODEL_RUNS.map((run) =>
      run.metrics.provider === 'gemini'
        ? { ...run, metrics: { ...run.metrics, p50Ms: 9600 } }
        : run,
    );
    expect(headline(slow)).toContain('4× faster than Gemini (2.4 s vs 9.6 s)');
  });

  it('one card per model: right answers, money mistakes, typical reply, cost, role', () => {
    render(<ModelChoice runs={MODEL_RUNS} />);
    const sarvam = within(cardOf('sarvam-105b'));
    expect(sarvam.getByText('96%')).toBeInTheDocument();
    expect(sarvam.getByText('22 of 23')).toBeInTheDocument();
    expect(sarvam.getByText('0 of 12')).toBeInTheDocument();
    expect(sarvam.getByText('2.4 s')).toBeInTheDocument();
    expect(sarvam.getByText('slowest 6.1 s')).toBeInTheDocument();
    expect(sarvam.getByText('Telugu / Hindi: 9 of 9 right')).toBeInTheDocument();
    expect(sarvam.getByText('In use')).toBeInTheDocument();
    expect(sarvam.getByText('Yes')).toBeInTheDocument();
    expect(
      within(cardOf('gemini-2.5-flash')).getByText('Backup if Sarvam fails'),
    ).toBeInTheDocument();
  });

  it('a model that is not safe on its own says why, message by message', () => {
    render(<ModelChoice runs={MODEL_RUNS} />);
    const gemini = within(cardOf('gemini-2.5-flash'));
    expect(gemini.getByText('No')).toBeInTheDocument();
    expect(
      gemini.getByText(
        /Money mistake on “Ramesh 5000 due 15th”\. In the live product our code reads/,
      ),
    ).toBeInTheDocument();
    expect(
      gemini.getByText(/“Suresh ko kal kuch paisa”\. Our code does not read this message first/),
    ).toBeInTheDocument();
    expect(gemini.getByText('1 message(s) got no answer (free-tier limit).')).toBeInTheDocument();
  });

  it('a variant with the same numbers is one line, not a second card', () => {
    const twin = {
      ...first(),
      id: 'model-run-3',
      metrics: { ...first().metrics, model: 'sarvam-105b-conversations', p50Ms: 2380 },
    };
    expect(splitTwins([...MODEL_RUNS, twin]).shown).toHaveLength(2);
    render(<ModelChoice runs={[...MODEL_RUNS, twin]} />);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(
      screen.getByText(/sarvam-105b-conversations scored the same as sarvam-105b/),
    ).toBeInTheDocument();
  });

  it('how it was tested sits in a closed fold, each price note once', () => {
    const again = { ...first(), id: 'model-run-3', metrics: { ...first().metrics, model: 'x' } };
    render(<ModelChoice runs={[...MODEL_RUNS, again]} />);
    const fold = screen.getByText('How we tested').closest('details');
    expect(fold).not.toHaveAttribute('open');
    const notes = within(fold as HTMLElement).getByText(/with 18% GST/);
    expect(notes.textContent?.match(/Sarvam list price/g)).toHaveLength(1);
    expect(notes).toHaveTextContent('Gemini free tier.');
    expect(within(fold as HTMLElement).getByText(/Decision \(Saim, 23 Nov\)/)).toBeInTheDocument();
  });

  it('shows nothing before any bake-off has run', () => {
    const { container } = render(<ModelChoice runs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
