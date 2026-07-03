export function ErrorDisplay({
  message,
  title = 'Unable to load data',
  onRetry,
}) {
  if (!message) return null

  return (
    <div className="error-state" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  )
}
