import './ExitConfirm.css';

type Props = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function ExitConfirm({ onConfirm, onCancel }: Props) {
  return (
    <div className="exit-confirm" role="dialog" aria-label="Exit confirmation">
      <div className="exit-confirm__panel">
        <p>Are you sure you want to Exit?</p>
        <div>
          <button type="button" onClick={onCancel}>
            No
          </button>
          <button type="button" onClick={onConfirm}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
