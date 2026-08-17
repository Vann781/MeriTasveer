import { Link } from 'react-router-dom';
import { api } from '../services/api.js';

export function LoginPage() {
  return (
    <div className="min-h-screen px-5 sm:px-8">
      {/* Sits above centre rather than dead-centre — a centred block on a tall
          screen reads as a landing page, not as a way in. */}
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center pb-28">
        <p className="text-sm font-medium tracking-wide text-muted">MechQuish</p>

        <h1 className="title mt-3 text-[32px] leading-[1.15] sm:text-[38px]">Event photos</h1>

        <p className="mt-4 max-w-sm text-[17px] leading-relaxed text-ink-soft">
          Take three quick selfies and we&apos;ll pull out every photo you appear in from the
          club&apos;s event albums.
        </p>

        <a
          href={api.loginUrl}
          className="mt-9 inline-flex w-full items-center justify-center rounded-md bg-ink px-4 py-3 text-[15px] font-medium text-page transition-colors hover:bg-ink/90 sm:w-auto sm:self-start sm:px-6"
        >
          Continue with Google
        </a>

        <p className="mt-6 max-w-sm text-sm leading-relaxed text-muted">
          Your selfies are used only for the search and are never stored.
        </p>

        <div className="mt-14 border-t border-line pt-5 text-sm text-muted">
          <Link to="/help" className="hover:text-ink">
            Help and contact
          </Link>
        </div>
      </div>
    </div>
  );
}
