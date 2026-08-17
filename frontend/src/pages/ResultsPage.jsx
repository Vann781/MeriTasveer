import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { Button, Notice, Screen, Spinner } from '../components/Screen.jsx';

export function ResultsPage() {
  const { searchId } = useParams();
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    api
      .results(searchId)
      .then(setResults)
      .catch((err) => setError(err.message));
  }, [searchId]);

  if (error) {
    return (
      <Screen title="Your photos">
        <Notice tone="warning">{error}</Notice>
        <p className="mt-6">
          <Link to="/events" className="text-[15px] text-accent hover:underline">
            Back to events
          </Link>
        </p>
      </Screen>
    );
  }

  if (!results) {
    return (
      <Screen title="Your photos">
        <p className="flex items-center gap-2.5 text-[15px] text-muted">
          <Spinner /> Loading
        </p>
      </Screen>
    );
  }

  const { photos, event } = results;

  if (photos.length === 0) {
    return (
      <Screen
        title="No photos found"
        subtitle={event.name}
        back={
          <Link to="/events" className="text-sm text-muted hover:text-ink">
            Events
          </Link>
        }
      >
        <div className="max-w-md">
          <p className="text-[15px] leading-relaxed text-ink-soft">
            We compared your selfies against every face in this event and none of them matched. That
            usually means you are not in these particular photos — or that your face was too small
            or too blurred in them to read.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
            If you know you were there, it is worth trying again somewhere brighter.
          </p>

          <div className="mt-7">
            <Link to={`/events/${event.id}`}>
              <Button type="button">Try again</Button>
            </Link>
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      width="wide"
      title={`${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} of you`}
      subtitle={event.name}
      back={
        <Link to="/events" className="text-sm text-muted hover:text-ink">
          Events
        </Link>
      }
    >
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        {photos.map((photo) => (
          <li key={photo.id} className="group relative">
            <button
              type="button"
              onClick={() => setViewing(photo)}
              className="block aspect-square w-full overflow-hidden rounded-md bg-surface"
            >
              <img
                src={api.photoUrl(searchId, photo.id)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition-opacity hover:opacity-95"
              />
            </button>

            <a
              href={api.downloadUrl(searchId, photo.id)}
              className="absolute bottom-2 right-2 rounded bg-page/90 px-2 py-1 text-xs text-ink opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
            >
              Download
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm text-muted">
        This page stays available for a couple of hours. After that, search again.
      </p>

      {viewing && (
        <div
          className="fixed inset-0 z-20 flex flex-col items-center justify-center bg-ink/90 p-4"
          onClick={() => setViewing(null)}
          role="presentation"
        >
          <img
            src={api.photoUrl(searchId, viewing.id)}
            alt=""
            className="max-h-[78vh] w-auto max-w-full rounded-md object-contain"
          />

          <div className="mt-5 flex items-center gap-6 text-sm text-page">
            <a
              href={api.downloadUrl(searchId, viewing.id)}
              onClick={(clickEvent) => clickEvent.stopPropagation()}
              className="rounded-md bg-page px-4 py-2 font-medium text-ink"
            >
              Download
            </a>
            <button type="button" className="text-page/70 hover:text-page">
              Close
            </button>
          </div>
        </div>
      )}
    </Screen>
  );
}
