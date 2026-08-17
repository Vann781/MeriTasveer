import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { Button, Notice, Screen, Spinner } from '../components/Screen.jsx';
import { SelfieSlot } from '../components/SelfieSlot.jsx';
import { CameraCapture } from '../components/CameraCapture.jsx';

const SLOTS = [
  { label: 'Looking straight ahead', hint: 'Face the camera, eyes on the lens' },
  { label: 'Turned slightly left', hint: 'A small turn is enough' },
  { label: 'Turned slightly right', hint: 'Same again, the other way' },
];

export function EventPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [selfies, setSelfies] = useState([null, null, null]);
  const [error, setError] = useState(null);
  const [searching, setSearching] = useState(false);
  const [uploaded, setUploaded] = useState(0);
  const [cameraStep, setCameraStep] = useState(null);

  useEffect(() => {
    api
      .event(eventId)
      .then(setEvent)
      .catch((err) => setError(err.message));
  }, [eventId]);

  const taken = selfies.filter(Boolean).length;
  const ready = taken === SLOTS.length;

  /**
   * Stores the captured frame, then moves straight on to the next empty slot
   * so all three are taken in one run without returning to the list.
   */
  function captureSelfie(index, file) {
    setError(null);

    const updated = selfies.map((existing, i) => (i === index ? file : existing));
    setSelfies(updated);

    const nextEmpty = updated.findIndex((selfie) => !selfie);
    setCameraStep(nextEmpty === -1 ? null : nextEmpty);
  }

  async function findMyPhotos() {
    setSearching(true);
    setUploaded(0);
    setError(null);

    try {
      const result = await api.searchEvent(eventId, selfies, { onUploadProgress: setUploaded });
      navigate(`/results/${result.searchId}`);
    } catch (err) {
      setError(err.message);
      setSearching(false);
    }
  }

  if (searching) {
    return <SearchingScreen eventName={event?.name} uploaded={uploaded} />;
  }

  if (cameraStep !== null) {
    const slot = SLOTS[cameraStep];
    return (
      <CameraCapture
        step={cameraStep + 1}
        total={SLOTS.length}
        label={slot.label}
        hint={slot.hint}
        onCapture={(file) => captureSelfie(cameraStep, file)}
        onClose={() => setCameraStep(null)}
      />
    );
  }

  return (
    <Screen
      title={event?.name ?? 'Event'}
      subtitle="Three photos, taken now with your camera."
      back={
        <Link to="/events" className="text-sm text-muted hover:text-ink">
          Events
        </Link>
      }
    >
      <p className="max-w-md text-[15px] leading-relaxed text-ink-soft">
        Event photos catch you from every angle, so one selfie is rarely enough. Three lets us
        recognise you in profile and in bad light.
      </p>

      <ul className="-mx-3 mt-7">
        {SLOTS.map((slot, index) => (
          <SelfieSlot
            key={slot.label}
            index={index + 1}
            label={slot.label}
            hint={slot.hint}
            file={selfies[index]}
            onOpenCamera={() => setCameraStep(index)}
          />
        ))}
      </ul>

      {error && (
        <div className="mt-6">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      <div className="mt-8 flex items-center gap-5">
        <Button
          type="button"
          onClick={ready ? findMyPhotos : () => setCameraStep(selfies.findIndex((s) => !s))}
        >
          {ready ? 'Find my photos' : taken === 0 ? 'Start' : 'Continue'}
        </Button>

        {!ready && (
          <span className="text-sm text-muted">
            {taken} of {SLOTS.length} taken
          </span>
        )}
      </div>

      <p className="mt-10 max-w-md text-sm leading-relaxed text-muted">
        Photos are taken with your camera rather than uploaded, so the search can only be used to
        find yourself. Nothing is saved after the search runs.
      </p>
    </Screen>
  );
}

/**
 * The wait. Only two states are claimed, and both are real: the upload
 * percentage comes from the browser, and the search runs until the reply
 * arrives. Nothing is faked to look busy.
 */
function SearchingScreen({ eventName, uploaded }) {
  const uploadDone = uploaded >= 1;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 pb-28 sm:px-8">
      <h1 className="title text-2xl">Searching {eventName}</h1>

      <dl className="mt-8 space-y-3 text-[15px]">
        <div className="flex items-center gap-3">
          <dt className="w-4">
            {uploadDone ? <span className="text-muted">✓</span> : <Spinner />}
          </dt>
          <dd className={uploadDone ? 'text-muted' : 'text-ink'}>
            Sending your photos{!uploadDone && ` · ${Math.round(uploaded * 100)}%`}
          </dd>
        </div>

        <div className="flex items-center gap-3">
          <dt className="w-4">{uploadDone ? <Spinner /> : <span className="text-line-strong">·</span>}</dt>
          <dd className={uploadDone ? 'text-ink' : 'text-muted'}>Comparing faces</dd>
        </div>
      </dl>

      <p className="mt-8 text-sm text-muted">This usually takes a few seconds.</p>
    </div>
  );
}
