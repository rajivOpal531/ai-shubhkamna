import './Tips.css';

type Props = {
  onProceed: () => void;
  onBack: () => void;
};

const TIPS = [
  'Using back camera & avoid selfies',
  'From your head to waist',
  'In portrait orientation',
  'With a plain background',
  'With only you in the frame',
  'Without any objects, animals or filters',
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
      <h2>Tips for a perfect photo</h2>
      <p>For best experience, capture or upload your picture</p>
      <ol>
        {TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ol>
      <button type="button" onClick={onProceed}>
        Proceed
      </button>
    </div>
  );
}
