import { dismissToast, showError, useToast } from './toast'

export default function Toaster() {
  const toast = useToast()

  return (
    // The live region stays mounted so screen readers announce what appears in it.
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span className="toast-message">{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                const { run } = toast.action!
                dismissToast()
                Promise.resolve()
                  .then(run)
                  .catch(showError)
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
