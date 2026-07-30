/**
 * A real screen recording of the live site.
 *
 * Genuinely recorded, not simulated: puppeteer drove the actual built site at
 * 1280x800 and captured a webm of what rendered — the terminal demo typing
 * itself out, and a real published profile. Re-record with
 * scratchpad/rec/record.mjs if the pages change; do not fake frames.
 *
 * WEIGHT. mp4 1.05MB / webm 1.70MB. Both sit behind `preload="none"` and a 70KB
 * poster, so a visitor who never presses play downloads only the poster. That is
 * the whole reason this is a click-to-play element and not an autoplaying
 * background: a 1MB hero that plays whether you want it or not is a tax on
 * everyone with a metered connection.
 *
 * NO AUDIO TRACK, so there is nothing to caption. The transcript below is the
 * text equivalent of what the video shows, which is what makes the video itself
 * non-essential rather than the only route to the information.
 */

import { useState } from 'react';

const BASE = import.meta.env.BASE_URL;

export function SiteTour() {
  const [started, setStarted] = useState(false);

  return (
    <figure className="tour">
      <div className="tour-frame">
        {/* Rendered only after a click: the browser fetches nothing until then. */}
        {started ? (
          <video
            className="tour-video"
            controls
            autoPlay
            muted
            playsInline
            poster={`${BASE}media/tour-poster.jpg`}
            aria-label="Screen recording of the Ledger site: the command-line demo running, then a published profile."
          >
            <source src={`${BASE}media/tour.webm`} type="video/webm" />
            <source src={`${BASE}media/tour.mp4`} type="video/mp4" />
            {/* Reached only if neither source can play. */}
            <p>
              Your browser cannot play this video.{' '}
              <a href={`${BASE}media/tour.mp4`}>Download the recording (MP4, 1&nbsp;MB)</a>.
            </p>
          </video>
        ) : (
          <button type="button" className="tour-poster" onClick={() => setStarted(true)}>
            <img
              src={`${BASE}media/tour-poster.jpg`}
              alt="The Ledger homepage, showing the command-line demo mid-run."
              width={1152}
              height={720}
              loading="lazy"
              decoding="async"
            />
            <span className="tour-play" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
            </span>
            <span className="tour-cta">Watch the 28-second tour</span>
          </button>
        )}
      </div>

      <figcaption className="tour-cap muted">
        A real recording of this site — the CLI demo running, then a published profile.
        Silent, 28 seconds. Nothing downloads until you press play.
      </figcaption>
    </figure>
  );
}
