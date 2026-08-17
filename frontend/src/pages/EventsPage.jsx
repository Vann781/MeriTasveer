import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { Notice, Screen, Spinner } from '../components/Screen.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

export function EventsPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .events()
      .then(setEvents)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // An event with no recognisable faces cannot return results, so it is not
  // offered — better than letting someone search and always find nothing.
  const ready = events.filter((event) => event.status === 'ready' && event.faceCount > 0);
  const preparing = events.filter((event) => !ready.includes(event));

  return (
    <Screen
      title="Events"
      subtitle="Choose the event you attended."
      action={
        user?.isAdmin ? (
          <Link to="/admin" className="text-muted hover:text-ink">
            Admin
          </Link>
        ) : null
      }
    >
      {loading && (
        <p className="flex items-center gap-2.5 text-[15px] text-muted">
          <Spinner /> Loading events
        </p>
      )}

      {error && <Notice tone="warning">{error}</Notice>}

      {!loading && !error && ready.length === 0 && (
        <div className="max-w-md">
          <p className="text-[15px] leading-relaxed text-ink-soft">
            No events are ready to search yet. Photos have to be processed before anyone can be
            found in them, which the organizer does once per event.
          </p>
          <p className="mt-3 text-[15px] text-muted">Check back in a day or two.</p>
        </div>
      )}

      {/* A list, not a grid of cards: these are rows of the same kind of thing. */}
      <ul className="-mx-3">
        {ready.map((event) => (
          <li key={event.id} className="border-b border-line last:border-b-0">
            <Link
              to={`/events/${event.id}`}
              className="row-hover flex items-baseline justify-between gap-6 rounded-md px-3 py-4"
            >
              <span className="min-w-0 truncate text-[17px]">{event.name}</span>
              <span className="shrink-0 text-sm tabular-nums text-muted">
                {event.photoCount} photos
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {preparing.length > 0 && (
        <p className="mt-8 text-sm text-muted">
          {preparing.length} {preparing.length === 1 ? 'event is' : 'events are'} still being
          processed and will appear here once ready.
        </p>
      )}
    </Screen>
  );
}
