import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Full-screen camera. Selfies are taken here and nowhere else — there is no
 * file picker, so a photo of somebody else cannot be handed in through the UI.
 *
 * This screen stays dark while the rest of the app is light: a bright frame
 * around a live preview makes it hard to judge the shot, which is why every
 * camera app does the same.
 */
export function CameraCapture({ step, total, label, hint, onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      // Undefined on http:// pages other than localhost — cameras need a
      // secure context.
      if (!navigator.mediaDevices?.getUserMedia) {
        setError({
          title: 'Camera unavailable',
          detail:
            'This browser will not open a camera on this page. It needs a secure (https) connection.',
        });
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (err) {
        const messages = {
          NotAllowedError: {
            title: 'Camera access is off',
            detail:
              'Allow the camera for this site and try again. On a phone the setting is behind the icon in the address bar.',
          },
          NotFoundError: {
            title: 'No camera on this device',
            detail: 'Open the site on your phone to take your selfies.',
          },
          NotReadableError: {
            title: 'The camera is in use',
            detail: 'Another app has the camera open. Close it and try again.',
          },
        };

        setError(
          messages[err.name] ?? {
            title: 'The camera would not start',
            detail: 'Try again, or reload the page.',
          },
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    // Square crop from the centre: faces sit in the middle, and it matches
    // the preview the person just saw.
    const size = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    canvas
      .getContext('2d')
      .drawImage(
        video,
        (video.videoWidth - size) / 2,
        (video.videoHeight - size) / 2,
        size,
        size,
        0,
        0,
        size,
        size,
      );

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `selfie-${step}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-page px-8 text-center">
        <h2 className="title text-xl">{error.title}</h2>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-ink-soft">{error.detail}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-7 rounded-md border border-line-strong bg-surface px-4 py-2.5 text-[15px] font-medium"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[#141310]">
      <div className="flex items-center justify-between px-5 py-4 text-white/70">
        <span className="text-sm">
          {step} of {total}
        </span>
        <button type="button" onClick={onClose} className="text-sm hover:text-white">
          Cancel
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          // Mirrored so it feels like a mirror; the captured frame is not.
          className="h-full w-full -scale-x-100 object-cover"
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-white">
          <p className="text-[17px]">{label}</p>
          <p className="mt-1 text-sm text-white/60">{hint}</p>
        </div>
      </div>

      <div className="flex items-center justify-center py-8">
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          aria-label="Take photo"
          className="h-[68px] w-[68px] rounded-full border-[3px] border-white/90 p-1 transition-opacity disabled:opacity-30"
        >
          <span className="block h-full w-full rounded-full bg-white" />
        </button>
      </div>
    </div>
  );
}
