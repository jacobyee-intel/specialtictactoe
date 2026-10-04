import { notice } from '../controller';
import { dismissError, lastError } from '../store';

/**
 * The one-line message area under the HUD (no popups). It shows why the engine rejected the
 * last change, until the next successful change or until dismissed; otherwise the summary of
 * the last turn's resolution ("Player 1 won timeline #14 · …"). The live region is always
 * mounted so screen readers announce each new message.
 */
export function Toast() {
  const error = lastError.value;
  const message = error ?? notice.value;
  const dismiss = () => {
    if (error !== null) dismissError();
    else notice.value = null;
  };
  return (
    <div class="page toast" role="status" aria-live="polite">
      {message !== null && (
        <p class="toast-message">
          <span>{message}</span>
          <button type="button" class="btn btn--text t-caption" onClick={dismiss}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
