import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

/**
 * Page shell. One column, sized to its content rather than to the phone —
 * `width` lets a photo grid breathe on a laptop while text stays readable.
 */
export function Screen({ title, subtitle, back, action, width = 'narrow', children }) {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();

  const widths = { narrow: 'max-w-xl', wide: 'max-w-3xl' };

  return (
    <div className="min-h-screen">
      <div className={`mx-auto w-full px-5 pb-24 pt-8 sm:px-8 sm:pt-12 ${widths[width]}`}>
        {back && <div className="mb-6">{back}</div>}

        <header className="flex items-baseline justify-between gap-6 border-b border-line pb-5">
          <div className="min-w-0">
            <h1 className="title text-2xl leading-snug sm:text-[28px]">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[15px] text-ink-soft">{subtitle}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-5 text-sm">
            {action}
            {user && (
              <button type="button" onClick={signOut} className="text-muted hover:text-ink">
                Sign out
              </button>
            )}
          </div>
        </header>

        <div className="mt-8">{children}</div>

        {pathname !== '/help' && (
          <footer className="mt-20 border-t border-line pt-5 text-sm text-muted">
            <Link to="/help" className="hover:text-ink">
              Help and contact
            </Link>
          </footer>
        )}
      </div>
    </div>
  );
}

export function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line-strong border-t-ink ${className}`}
      aria-hidden="true"
    />
  );
}

/** Used for things the participant needs to read, not for decoration. */
export function Notice({ tone = 'info', children }) {
  const tones = {
    info: 'border-line bg-surface text-ink-soft',
    warning: 'border-accent/25 bg-accent-soft text-ink',
  };
  return (
    <div className={`rounded-md border px-4 py-3 text-[15px] leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}

/** The one primary action on a screen. */
export function Button({ variant = 'primary', className = '', ...props }) {
  const variants = {
    primary:
      'bg-ink text-page hover:bg-ink/90 disabled:bg-line-strong disabled:text-muted disabled:cursor-not-allowed',
    secondary: 'border border-line-strong bg-surface text-ink hover:border-muted disabled:opacity-50',
  };

  return (
    <button
      {...props}
      className={`rounded-md px-4 py-2.5 text-[15px] font-medium transition-colors ${variants[variant]} ${className}`}
    />
  );
}
