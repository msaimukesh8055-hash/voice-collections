// web/src/features/evals/AddTestCase.tsx
// "Add as a test case" (Saim, 2026-11-20), on a call report and on a WhatsApp trace: saves a
// draft that is later written up as a scripted test and approved by Saim before it joins the
// release gate. For a call the server takes what was said and what went wrong from the call
// itself; for a WhatsApp message the owner types what he sent (the bot never stores the text).
import { type ChangeEvent, type FormEvent, useState } from 'react';
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type { TestDraftSource } from '../../lib/testDraftSchemas.ts';
import { Card } from '../dashboard/Layout.tsx';

type Phase = 'closed' | 'open' | 'saving' | 'saved' | 'failed';
type TextChange = (event: ChangeEvent<HTMLTextAreaElement>) => void;

const FIELD =
  'mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-brand';
const MAX_SAID = 1000;
const MAX_EXPECTED = 500;

function SavedNote(): React.JSX.Element {
  return (
    <Card>
      <p className="text-sm text-success">
        Added to the tests waiting on the Evals page. It joins the release gate once you approve its
        wording.
      </p>
    </Card>
  );
}

function OpenButton({ onOpen }: { readonly onOpen: () => void }): React.JSX.Element {
  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-lg border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand-soft"
      >
        Add as a test case
      </button>
    </div>
  );
}

function SaidField({
  needsWords,
  said,
  onChange,
}: {
  readonly needsWords: boolean;
  readonly said: string;
  readonly onChange: TextChange;
}): React.JSX.Element {
  if (!needsWords) {
    return (
      <p className="text-ink-muted">What was said and what went wrong are taken from this call.</p>
    );
  }
  return (
    <label>
      What did you send? (the bot does not keep message text)
      <textarea required maxLength={MAX_SAID} value={said} onChange={onChange} className={FIELD} />
    </label>
  );
}

interface FormProps {
  readonly phase: Phase;
  readonly needsWords: boolean;
  readonly said: string;
  readonly expected: string;
  readonly onSaid: TextChange;
  readonly onExpected: TextChange;
  readonly onSave: (event: FormEvent<HTMLFormElement>) => void;
}

function DraftForm(props: FormProps): React.JSX.Element {
  const { phase, needsWords, said } = props;
  return (
    <Card title="Add as a test case">
      <form onSubmit={props.onSave} className="flex flex-col gap-3 text-sm">
        <SaidField needsWords={needsWords} said={said} onChange={props.onSaid} />
        <label>
          What should have happened? (optional)
          <textarea
            maxLength={MAX_EXPECTED}
            value={props.expected}
            onChange={props.onExpected}
            className={FIELD}
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={phase === 'saving' || (needsWords && said.trim() === '')}
            className="rounded-lg bg-brand px-3 py-1.5 font-medium text-on-brand disabled:opacity-50"
          >
            {phase === 'saving' ? 'Saving…' : 'Save draft'}
          </button>
          {phase === 'failed' ? (
            <span className="text-danger">Could not save. Try again.</span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

export function AddTestCase({
  dashboard,
  source,
  refId,
}: {
  readonly dashboard: Pick<DashboardApi, 'addTestDraft'>;
  readonly source: TestDraftSource;
  readonly refId: string;
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('closed');
  const [said, setSaid] = useState('');
  const [expected, setExpected] = useState('');
  const needsWords = source === 'whatsapp';

  function open(): void {
    setPhase('open');
  }
  function changeSaid(event: ChangeEvent<HTMLTextAreaElement>): void {
    setSaid(event.target.value);
  }
  function changeExpected(event: ChangeEvent<HTMLTextAreaElement>): void {
    setExpected(event.target.value);
  }
  function done(): void {
    setPhase('saved');
  }
  function failed(): void {
    setPhase('failed');
  }
  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPhase('saving');
    const words = needsWords ? { said: said.trim() } : {};
    const should = expected.trim() ? { expected: expected.trim() } : {};
    dashboard.addTestDraft({ source, refId, ...words, ...should }).then(done, failed);
  }

  if (phase === 'saved') return <SavedNote />;
  if (phase === 'closed') return <OpenButton onOpen={open} />;
  return (
    <DraftForm
      phase={phase}
      needsWords={needsWords}
      said={said}
      expected={expected}
      onSaid={changeSaid}
      onExpected={changeExpected}
      onSave={save}
    />
  );
}
