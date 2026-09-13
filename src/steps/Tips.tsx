import './Tips.css';

type Props = {
  onProceed: () => void;
  onBack: () => void;
};

type Tip = { pre: string; em?: string; post?: string };

const TIPS: Tip[] = [
  { pre: 'Using ', em: 'back camera', post: ' & avoid selfies' },
  { pre: 'From your ', em: 'head to waist' },
  { pre: 'In portrait orientation' },
  { pre: 'With a plain background' },
  { pre: 'With only you in the frame' },
  { pre: 'Without any objects, animals or filters' },
];

export function Tips({ onProceed, onBack }: Props) {
  return (
    <div className="tips">
      <header className="tips__header">
        <button type="button" aria-label="Back" onClick={onBack}>
          ←
        </button>
        <h1>AI Shubhkamna</h1>
      </header>

      <h2 className="tips__title">Tips for a perfect photo</h2>

      {/* TODO(asset): export the "hand holding phone" cartoon from Figma to
          src/assets/tips-illustration.png and drop it into this circle. */}
      <div className="tips__illustration" aria-hidden="true" />

      <div className="tips__card">
        <p className="tips__lead">For best experience, capture or upload your picture</p>
        <ol className="tips__list">
          {TIPS.map((tip, i) => (
            <li key={i}>
              {tip.pre}
              {tip.em && <span className="tips__em">{tip.em}</span>}
              {tip.post}
            </li>
          ))}
        </ol>
      </div>

      <button type="button" className="tips__proceed" onClick={onProceed}>
        Proceed
      </button>
    </div>
  );
}
