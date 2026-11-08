// web/src/features/phone/CallVisual.test.tsx
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar.tsx';
import { CallVisual } from './CallVisual.tsx';
import { DiallingScreen } from './DiallingScreen.tsx';

function lane(direction: 'right' | 'left'): string | null {
  return screen.getByTestId(`lane-${direction}`).getAttribute('data-active');
}

function speaking(role: 'agent' | 'person'): string | null {
  return screen.getByTestId(`avatar-${role}`).getAttribute('data-speaking');
}

describe('CallVisual (M7 B2)', () => {
  it('agent speaking: top lane → active, gold ring on the agent, said in words', () => {
    render(<CallVisual speaker="asha" connecting={false} shopkeeperName="Ramesh" />);
    expect([lane('right'), lane('left')]).toEqual(['yes', 'no']);
    expect([speaking('agent'), speaking('person')]).toEqual(['yes', 'no']);
    expect(screen.getByRole('status')).toHaveTextContent('Asha is speaking');
  });

  it('person speaking: bottom lane ← active, ring on the person', () => {
    render(<CallVisual speaker="shopkeeper" connecting={false} shopkeeperName="Ramesh" />);
    expect([lane('right'), lane('left')]).toEqual(['no', 'yes']);
    expect([speaking('agent'), speaking('person')]).toEqual(['no', 'yes']);
    expect(screen.getByRole('status')).toHaveTextContent('Ramesh is speaking');
  });

  it('nobody speaking: both lanes faint, "Listening"', () => {
    render(<CallVisual speaker={null} connecting={false} shopkeeperName="Ramesh" />);
    expect([lane('right'), lane('left')]).toEqual(['no', 'no']);
    expect(screen.getByTestId('speaking-arrow')).toHaveAttribute('data-direction', 'none');
    expect(screen.getByRole('status')).toHaveTextContent('Listening');
  });

  it('while connecting, nothing flows', () => {
    render(<CallVisual speaker="asha" connecting shopkeeperName="You" />);
    expect([lane('right'), lane('left')]).toEqual(['no', 'no']);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
  });

  it('Munshi: a male agent face, the owner as a male face, the AI tag on the agent only', () => {
    render(
      <CallVisual
        speaker="asha"
        connecting={false}
        shopkeeperName="You"
        agentName="Munshi"
        agentGender="male"
        personGender="male"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Munshi is speaking');
    expect(screen.getByRole('img', { name: 'Munshi, AI assistant' })).toBeInTheDocument();
    expect(screen.getAllByText('AI')).toHaveLength(1);
    const faces = Array.from(document.querySelectorAll('[data-face]')).map((face) =>
      face.getAttribute('data-face'),
    );
    expect(faces).toEqual(['male', 'male']);
  });

  it('Asha is female by default; an unknown person gets the neutral face', () => {
    render(<CallVisual speaker={null} connecting={false} shopkeeperName="Kiran" />);
    const faces = Array.from(document.querySelectorAll('[data-face]')).map((face) =>
      face.getAttribute('data-face'),
    );
    expect(faces).toEqual(['female', 'neutral']);
  });
});

describe('Avatar', () => {
  it('names the person for screen readers, with no AI tag', () => {
    render(<Avatar name="Radha" gender="female" role="person" />);
    expect(screen.getByRole('img', { name: 'Radha' })).toBeInTheDocument();
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
  });

  it('a neutral agent still wears the headset and the AI tag', () => {
    render(<Avatar name="Asha" gender="neutral" role="agent" />);
    expect(document.querySelector('[data-face="neutral"] rect[rx]')).not.toBeNull();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });
});

describe('DiallingScreen', () => {
  it('shows the agent breathing and what is happening, as a status', () => {
    render(<DiallingScreen agentName="Asha" agentGender="female" label="Connecting to Asha" />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to Asha…');
    expect(screen.getByRole('img', { name: 'Asha, AI assistant' })).toHaveClass('animate-dial');
  });
});
