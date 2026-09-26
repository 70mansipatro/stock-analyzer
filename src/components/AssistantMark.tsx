/** Brand mark for the AI assistant: a chat bubble holding three candlesticks. */
export function AssistantMark({ className = "h-6 w-6", animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M6 5.5h20a3.5 3.5 0 0 1 3.5 3.5v11a3.5 3.5 0 0 1-3.5 3.5H14.5l-5.6 4.4c-.66.52-1.62.05-1.62-.79V23.5H6A3.5 3.5 0 0 1 2.5 20V9A3.5 3.5 0 0 1 6 5.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <g className={animated ? "mark-bars" : undefined}>
        <line x1="10" y1="10.5" x2="10" y2="19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="8.4" y="13" width="3.2" height="4" rx="0.8" fill="currentColor" />
        <line x1="16" y1="8.5" x2="16" y2="18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="14.4" y="10.5" width="3.2" height="5.5" rx="0.8" fill="currentColor" />
        <line x1="22" y1="9.5" x2="22" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="20.4" y="11" width="3.2" height="3.5" rx="0.8" fill="currentColor" />
      </g>
    </svg>
  );
}
