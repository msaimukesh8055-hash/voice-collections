// web/src/features/calls/checkHelp.test.tsx
// Plain-English help (Saim, 2026-11-20): every check the scorecards can produce has a line; a
// missed check also says why it matters; the menu groups the agent pages under "Agent ops".
import { render, screen, within } from '@testing-library/react';
import { Layout } from '../dashboard/Layout.tsx';
import { fakeDashboard } from '../../test/dashboardFakes.ts';
import { checkHelp } from './checkHelp.ts';
import { Scorecard } from './Scorecard.tsx';

/** Every check id in scorecard.ts, munshi-scorecard.ts and tone-judge.ts (2026-11-20). */
const ALL_CHECK_IDS = [
  'amounts_from_tools',
  'call_setup',
  'callback_announced',
  'calling_hours',
  'changes_done',
  'closed_with_consent',
  'could_not_answer',
  'followup_time',
  'identity_first',
  'interruptions',
  'llm_cost',
  'long_turns',
  'longest_turn',
  'no_discount',
  'nothing_left_open',
  'promise_read_back',
  'questions_answered',
  'read_back_first',
  'recording_notice',
  'repeated_calls',
  'repeated_figures',
  'reply_max',
  'reply_p50',
  'result_recorded',
  'slowest_tool',
  'summary_matches',
  'summary_writer',
  'tool_calls',
  'tool_errors',
  'total_cost',
  'voice_cost',
  'whatsapp_on_request',
  'wrong_person',
  'yes_before_save',
  'tone_respectful',
  'tone_no_pressure',
  'tone_listened',
  'tone_clear',
  'tone_friendly',
  'tone_language_match',
  'tone_on_point',
  'wa_money_on_tap',
  'wa_no_card_when_lost',
  'wa_understood',
  'wa_card_answered',
  'wa_voice_reply',
  'wa_delivered',
  'wa_reply_time',
  'wa_cost',
];

describe('check help', () => {
  it('has a plain-English line for every check, and one for any tool-needed row', () => {
    const missing = ALL_CHECK_IDS.filter((id) => checkHelp(id) === null);
    expect(missing).toEqual([]);
    expect(checkHelp('tool_use_book_summary')?.means).toContain('book_summary');
    expect(checkHelp('made_up')).toBeNull();
  });

  it('shows what a check means, and why it matters only when it missed', () => {
    render(
      <Scorecard
        card={{
          verdict: 'failed',
          passed: 1,
          applicable: 2,
          groups: [
            {
              name: 'Outcome',
              checks: [
                {
                  id: 'callback_announced',
                  label: 'Told them the owner will call back',
                  status: 'fail',
                  value: 'not said',
                },
                { id: 'tool_calls', label: 'Tool calls', status: 'pass', value: '2' },
              ],
            },
          ],
          toolUse: [],
          gaps: [],
        }}
      />,
    );
    expect(
      screen.getByText(/must also tell the shopkeeper the owner will call back/),
    ).toBeVisible();
    expect(screen.getByText(/Why it matters: The request was logged/)).toBeVisible();
    expect(screen.getAllByText(/Why it matters/)).toHaveLength(1);
  });

  it('groups the agent pages under "Agent ops" in the menu', () => {
    render(
      <Layout current="/health" dashboard={fakeDashboard().dashboard}>
        <p>page</p>
      </Layout>,
    );
    const group = screen.getByRole('group', { name: 'Agent ops' });
    const links = within(group)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(links).toEqual([
      'Asha calls',
      'Munshi calls',
      'WhatsApp chats',
      'Agent health',
      'Ops',
      'Evals',
    ]);
    expect(within(group).queryByRole('link', { name: 'Dashboard' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'About this page' })).toHaveTextContent(
      'This is the operator console, not the product.',
    );
  });
});
