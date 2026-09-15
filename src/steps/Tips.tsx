import { useEffect } from 'react';
import { AppBackground } from '../components/AppBackground';
import tipsIllustration from '../assets/tips-illustration.png';
import type { TrackFn } from '../services/analytics';
import './Tips.css';

type Props = {
  onProceed: () => void;
  onBack: () => void;
  track?: TrackFn;
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

export function Tips({ onProceed, onBack, track }: Props) {
  useEffect(() => {
    track?.('pageload');
    // Fire once on mount; `track` identity changes per render but the page is viewed once here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="tips">
      <AppBackground />
      <header className="tips__header">
        <button
          type="button"
          aria-label="Back"
          onClick={() => {
            track?.('back');
            onBack();
          }}
        >
          ←
        </button>
        <h1>AI Shubhkamna</h1>
      </header>

      <h2 className="tips__title">Tips for a perfect photo</h2>

      <div className="tips__illustration">
        <img src={tipsIllustration} alt="" />
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

      <button
        type="button"
        className="tips__proceed"
        onClick={() => {
          track?.('proceed');
          onProceed();
        }}
      >
        Proceed
      </button>
    </div>
  );
}
