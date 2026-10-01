/** The main pane when no conversation or screen is open. */
export function EmptyState() {
  return (
    <div className="empty-state">
      <span className="es-glyph" aria-hidden="true">
        <svg
          width="56"
          height="56"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2 4 5.5v6c0 4.6 3.2 7.6 8 8.9 4.8-1.3 8-4.3 8-8.9v-6L12 2Z" />
          <path d="M9 11.5 11 13.5 15.5 9" />
        </svg>
      </span>
      <h3>No channel selected</h3>
      <p>Choose a channel from the left, or search for a username to open a new one.</p>
    </div>
  )
}
