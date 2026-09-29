export function Brand({ size = 1 }: { size?: number }) {
  return (
    <span className="brand" style={{ fontSize: 18 * size }}>
      <span className="brand-glyph" aria-hidden="true">
        <svg
          width={22 * size}
          height={22 * size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2 4 5.5v6c0 4.6 3.2 7.6 8 8.9 4.8-1.3 8-4.3 8-8.9v-6L12 2Z" />
          <path d="M9 11.5 11 13.5 15.5 9" />
        </svg>
      </span>
      <span className="brand-word">
        krypto<b>chat</b>
      </span>
    </span>
  )
}
