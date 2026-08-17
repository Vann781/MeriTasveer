import { Link } from 'react-router-dom';
import { Screen } from '../components/Screen.jsx';

const FAQS = [
  [
    'Why three photos instead of one?',
    'Event photos catch you mid-laugh, side-on, half in shadow. One selfie only recognises one version of you. Three angles cover far more of them, which finds more of your photos and makes it far less likely that someone else is matched as you.',
  ],
  [
    'It says no photos were found',
    'Either you are not in that event’s photos, or your face was too small or blurred to read — group shots taken from a distance are hard. Photos shared over WhatsApp are compressed heavily, and faces in them can be too small for any software to recognise.',
  ],
  [
    'Why can’t I upload a photo I already have?',
    'Selfies are taken with your camera at the moment you search, so the site can only be used to find yourself rather than to look someone else up. You will need a device with a camera and you will be asked to allow access the first time.',
  ],
  [
    'Are my selfies kept?',
    'No. They exist in memory while the search runs and are dropped afterwards. They are never written to disk, never stored in the database, and never uploaded to Google Drive.',
  ],
  [
    'Can other people see my photos?',
    'No. Results belong to the account that ran the search, and the link stops working after a couple of hours. The Drive folder itself is never shared.',
  ],
  [
    'An event is missing',
    'Events appear once their photos have been processed. If yours is not listed it is probably still waiting, so check back in a day or two.',
  ],
];

export function HelpPage() {
  return (
    <Screen
      title="Help"
      back={
        <Link to="/events" className="text-sm text-muted hover:text-ink">
          Back
        </Link>
      }
    >
      <section className="max-w-lg">
        <p className="text-[15px] leading-relaxed text-ink-soft">
          Pick the event you attended, take three quick selfies, and the site compares them against
          the faces in that event&apos;s photos. Only the event you chose is searched.
        </p>
      </section>

      <section className="mt-12 max-w-lg">
        <h2 className="text-sm font-medium text-muted">Questions</h2>

        <dl className="mt-4">
          {FAQS.map(([question, answer]) => (
            <div key={question} className="border-b border-line py-5 first:pt-0 last:border-b-0">
              <dt className="text-[15px] font-medium">{question}</dt>
              <dd className="mt-2 text-[15px] leading-relaxed text-ink-soft">{answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-12 max-w-lg">
        <h2 className="text-sm font-medium text-muted">Contact</h2>

        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
          Built by <span className="text-ink">Vayu Nandan Mishra</span>. If photos are missing, an
          event should be here and isn&apos;t, or something looks broken, send a mail and I&apos;ll
          take a look.
        </p>

        <p className="mt-3">
          <a href="mailto:cs23vayu@rbmi.in" className="text-[15px] text-accent hover:underline">
            cs23vayu@rbmi.in
          </a>
        </p>
      </section>

      <p className="mt-16 max-w-lg text-sm leading-relaxed text-muted">
        Photos stay in the club&apos;s Google Drive. This site only helps you find the ones
        you&apos;re in.
      </p>
    </Screen>
  );
}
