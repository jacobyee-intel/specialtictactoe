import { dismissError, lastError } from '../store';

/**
 * The one-line message area under the HUD (no popups). It shows why the engine rejected the
 * last change, until the next successful change or until dismissed. The live region is always
 * mounted so screen readers announce each new message.
 */
export function Toast() {
  const message = lastError.value;
  return (
    <div class="page toast" role="status" aria-live="polite">
      {message !== null && (
        <p class="toast-message">
          <span>{message}</span>
          <button type="button" class="btn btn--text t-caption" onClick={dismissError}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
