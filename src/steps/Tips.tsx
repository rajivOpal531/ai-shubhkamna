import { AppBackground } from '../components/AppBackground';
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
      <AppBackground />
      <header className="tips__header">
        <button type="button" aria-label="Back" onClick={onBack}>
          ←
        </button>
        <h1>AI Shubhkamna</h1>
      </header>

      <h2 className="tips__title">Tips for a perfect photo</h2>

      {/* Placeholder cartoon (hand holding a phone). Swap for the exact Figma raster at
          src/assets/tips-illustration.png when available. */}
      <div className="tips__illustration" aria-hidden="true">
        <svg viewBox="0 0 160 160" width="150" height="150">
          <circle cx="80" cy="80" r="78" fill="#f3ecff" />
          <rect x="54" y="34" width="52" height="86" rx="10" fill="#4c3fbb" />
          <rect x="60" y="42" width="40" height="60" rx="4" fill="#fff" />
          <circle cx="80" cy="110" r="4" fill="#fff" />
          <circle cx="80" cy="66" r="13" fill="none" stroke="#4c3fbb" strokeWidth="3" />
          <path d="M72 78h16l-2-5h-12z" fill="#4c3fbb" />
          <path d="M40 150c2-22 14-34 30-34" fill="none" stroke="#e08a1e" strokeWidth="9" strokeLinecap="round" />
          <path d="M104 132c9 2 15 8 17 18" fill="none" stroke="#e08a1e" strokeWidth="9" strokeLinecap="round" />
          <g fill="#ffc94d">
            <circle cx="118" cy="46" r="3" />
            <circle cx="40" cy="60" r="2.5" />
            <circle cx="128" cy="92" r="2.5" />
          </g>
        </svg>
      </div>

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
