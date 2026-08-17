import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { Button, Notice, Screen, Spinner } from '../components/Screen.jsx';

const STATUS_TEXT = {
  pending: 'Not processed',
  indexing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

export function AdminPage() {
  const [events, setEvents] = useState([]);
  const [busyWith, setBusyWith] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.adminEvents();
      setEvents(data.events);
      setBusyWith(data.busyWith);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => clearTimeout(timer.current);
  }, [refresh]);

  // Poll only while something is processing. No polling when idle.
  useEffect(() => {
    if (busyWith === null) return undefined;
    timer.current = setTimeout(refresh, 3000);
    return () => clearTimeout(timer.current);
  }, [busyWith, events, refresh]);

  async function indexEvent(eventId) {
    try {
      await api.indexEvent(eventId);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      await api.syncEvents();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const indexed = events.filter((event) => event.status === 'ready').length;
  const pending = events.length - indexed;

  return (
    <Screen
      width="wide"
      title="Events"
      subtitle="Photos have to be processed once before participants can be found in them."
      back={
        <Link to="/events" className="text-sm text-muted hover:text-ink">
          Participant view
        </Link>
      }
      action={
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="text-muted hover:text-ink disabled:opacity-50"
        >
          {syncing ? 'Checking…' : 'Check Drive'}
        </button>
      }
    >
      {/* One summary line rather than three metric tiles. */}
      {!loading && (
        <p className="text-[15px] text-ink-soft">
          {indexed} of {events.length} processed
          {pending > 0 && <span className="text-muted"> · {pending} left to do</span>}
        </p>
      )}

      {error && (
        <div className="mt-5">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      {loading && (
        <p className="flex items-center gap-2.5 text-[15px] text-muted">
          <Spinner /> Loading
        </p>
      )}

      <ul className="-mx-3 mt-6">
        {events.map((event) => (
          <li key={event.id} className="border-b border-line last:border-b-0">
            <div className="flex items-center gap-4 px-3 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">{event.name}</p>

                <p className="mt-0.5 text-sm text-muted">
                  {event.status === 'ready' ? (
                    <>
                      {event.photoCount} photos, {event.faceCount} faces
                    </>
                  ) : (
                    <span className={event.status === 'failed' ? 'text-accent' : undefined}>
                      {STATUS_TEXT[event.status] ?? event.status}
                    </span>
                  )}
                </p>

                {event.status === 'indexing' && event.progress?.total ? (
                  <p className="mt-1 text-sm tabular-nums text-muted">
                    {event.progress.processed} of {event.progress.total} photos ·{' '}
                    {event.progress.faces} faces
                  </p>
                ) : null}

                {event.status === 'failed' && event.progress?.error && (
                  <p className="mt-1 text-sm text-muted">{event.progress.error}</p>
                )}
              </div>

              <Button
                variant="secondary"
                type="button"
                disabled={busyWith !== null}
                onClick={() => indexEvent(event.id)}
                className="shrink-0 px-3 py-1.5 text-sm"
              >
                {event.status === 'ready' ? 'Redo' : 'Process'}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {busyWith !== null && (
        <p className="mt-6 text-sm text-muted">
          Events are processed one at a time. The other buttons come back when this finishes.
        </p>
      )}
    </Screen>
  );
}
