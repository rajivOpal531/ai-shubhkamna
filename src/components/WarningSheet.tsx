import './WarningSheet.css';

type Props = {
  retakeLabel: string;
  onIgnore: () => void;
  onRetake: () => void;
};

/**
 * Shown over the preview when the composited photo overlaps the caption. The user can Ignore
 * (keep the poster as is) or Retake / Reupload a better photo.
 */
export function WarningSheet({ retakeLabel, onIgnore, onRetake }: Props) {
  return (
    <div className="warning-sheet" role="alertdialog" aria-label="Your poster can be improved">
      <div className="warning-sheet__backdrop" onClick={onIgnore} />
      <div className="warning-sheet__panel">
        <svg className="warning-sheet__icon" width="34" height="34" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <path
            d="M5.01431 26.1475H24.9866C25.311 26.1474 25.6298 26.0632 25.9119 25.9031C26.194 25.7429 26.4297 25.5123 26.596 25.2338C26.7623 24.9553 26.8536 24.6384 26.8608 24.3141C26.868 23.9898 26.7909 23.6692 26.6372 23.3836L16.6516 4.83867C15.9432 3.52383 14.0577 3.52383 13.3493 4.83867L3.36373 23.3836C3.20995 23.6692 3.1329 23.9898 3.14011 24.3141C3.14732 24.6384 3.23855 24.9553 3.40487 25.2338C3.57119 25.5123 3.80691 25.7429 4.08901 25.9031C4.37111 26.0632 4.68993 26.1474 5.01431 26.1475Z"
            stroke="#4B58B7"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14.6633 11.4483L14.9996 18.5967L15.3354 11.4512C15.3375 11.4055 15.3302 11.3599 15.314 11.3171C15.2979 11.2743 15.2732 11.2353 15.2414 11.2024C15.2097 11.1695 15.1715 11.1434 15.1294 11.1257C15.0872 11.1081 15.0418 11.0992 14.9961 11.0996C14.9512 11.1001 14.9068 11.1095 14.8656 11.1274C14.8244 11.1453 14.7872 11.1712 14.7561 11.2037C14.7251 11.2362 14.7009 11.2746 14.685 11.3166C14.669 11.3586 14.6617 11.4034 14.6633 11.4483Z"
            stroke="#4B58B7"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15 23.2764C14.7682 23.2764 14.5417 23.2076 14.3489 23.0789C14.1562 22.9501 14.006 22.7671 13.9173 22.5529C13.8286 22.3388 13.8054 22.1032 13.8506 21.8759C13.8959 21.6486 14.0075 21.4397 14.1714 21.2759C14.3352 21.112 14.5441 21.0004 14.7714 20.9551C14.9987 20.9099 15.2343 20.9331 15.4485 21.0218C15.6626 21.1105 15.8456 21.2607 15.9744 21.4534C16.1031 21.6461 16.1719 21.8727 16.1719 22.1045C16.1719 22.4153 16.0484 22.7134 15.8286 22.9331C15.6089 23.1529 15.3108 23.2764 15 23.2764Z"
            fill="#4B58B7"
          />
        </svg>
        <p className="warning-sheet__text">
          Your poster can be improved!
          <br />
          Please upload a photo showing your upper body in full.
        </p>
        <div className="warning-sheet__actions">
          <button type="button" className="warning-sheet__ignore" onClick={onIgnore}>
            Ignore
          </button>
          <button type="button" className="warning-sheet__retake" onClick={onRetake}>
            {retakeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
