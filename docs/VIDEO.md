# Watch together — synced video playback

The room page has a theater ("Watch together") above the mini-browser.
Either side picks a video — YouTube link, direct video link, or a file
from their device — and it plays on the big screen for both. Play, pause
and seeking stay in sync over the existing PeerJS data connection. Video
calling (camera) is separate and not built yet.

## Picking a video

- **YouTube link** (watch, youtu.be, shorts, embed, live, bare id):
  the room first asks a Piped instance for an ad-free direct stream
  (MP4 preferred, highest quality) and plays it in the room's own
  `<video>` element. Any failure — Piped down, no stream, stream dies
  mid-play — falls back to the plain YouTube embed, never a dead screen.
- **Direct link** (`.mp4`, `.webm`, `.mov`, `.mkv`, …): plays in the
  `<video>` element. `.ts` / `.flv` / `.m3u8` are refused with a plain
  message — this app ships no MSE demuxer or hls.js.
- **Local file**: plays from a blob URL on the picking phone and is
  shared live to the partner over a second PeerJS call (see below).

A pick is saved as a `room_media` record (same pattern as weblinks:
`type`, `url`, `title`) and sent to the partner as a `media` message.
The room's latest media mounts again on load, paused at the start — the
partner's live position is not stored server-side, so a late joiner
presses Play to catch up. A saved local file has no stream any more; the
room says so instead of mounting a dead player.

## Playback messages

`{ kind: 'playback', isPlaying, currentTime, duration, actionLabel, seq,
by, byPeer, updatedBy, at }`, sent on every play / pause / seek, plus a
`heartbeat` every 10s while playing. `seq` is per-device — each side
numbers its own messages, and the receiver only compares a sender's seq
with that sender's previous seq (comparing with your own counter would
drop the partner's pause as "stale", because your heartbeats keep your
counter ahead).

The guards, ported from the static app (?v=49):

- A stale or duplicate seq is dropped.
- A `heartbeat` that says "still playing" while your player is paused
  is dropped — it must never START playback (it was fired before the
  partner's pause reached you).
- A raw PLAYING event within 5s of applying the partner's pause is
  swallowed, not rebroadcast — YouTube resumes on its own after
  buffering, and re-broadcasting it would re-play the partner.
- A same-state broadcast matching the last remote-applied state (within
  3s of the expected time) is swallowed — your own player's echo of the
  partner's action, sent back.
- Heartbeats never move the playhead (their timestamp comes from the
  partner's clock); only real actions seek, and only when the playheads
  differ by more than 1.5s. A playing state catches up at most 10s for
  clock skew.

Pure decisions live in `public/js/room-player.js` (`window.CinemaPlayer`)
and are unit-tested in `tests/js/room-player.test.js`.

## Local-file sharing

The sender's playing file is captured with `video.captureStream(20)` and
sent over a second PeerJS call with `metadata: { kind: 'movie' }`; the
receiver mounts that stream on the main player. Send bitrate is capped at
800kbps (same cap as the static app). The receiver's transport controls
send `movie-control` intents (`play` / `pause` / `seek`) and the sender
drives its own file. If the partner picks the same file themselves, the
stream stops — they have the file. A dropped call re-shares after 2s;
an intentional stop does not.

## Errors, plainly

- Network error on a direct link: reload once, then a banner.
- Dead Piped stream: fall back to the YouTube embed.
- Format the browser cannot decode (code 4) or a black screen with
  sound (HEVC/DivX video, audio plays, no error event): a plain-language
  banner saying so. There is no converter in this app — pick an
  MP4 (H.264/AAC) or WebM file instead.
- YouTube embed errors (101/150 owner disabled embedding, 100 private
  or deleted): the banner says which.

## Harness notes

- `tests/js/video-sync-smoke.mjs` drives the whole flow in headless
  Chrome against the local app: share, partner mount, remote pause /
  play / seek, stale-seq drop, heartbeat would-start drop, no
  rebroadcast bounce, YouTube mount path, local file + movie-control,
  reload from the saved record.
- Direct-link test videos come from a tiny Range-capable server inside
  the smoke script — `php artisan serve` ignores Range requests, so
  Chrome cannot seek in anything it serves (every seek snaps to 0).
  Test videos are the 10s files in `~/workspace/cinema-for-two/
  harness/videos/` (`mp4-10s-h264-aac.mp4`, `webm-10s-vp9-opus.webm`,
  keyframes every 0.5s).
- The live two-phone PeerJS leg is NOT provable from the sandbox (no
  UDP/WebRTC here). The partner leg is driven through the same
  `handlePeerMessage` the live data connection calls, with the exact
  payloads it delivers. The actual media stream of a shared local file
  is likewise unproven here — the `movie-control` handler is exercised,
  the live call is not.

## Not built

- Video/voice calling (camera) — separate, not approved.
- A converter for unplayable formats — the static app has one
  (FFmpeg.wasm 0.11); this app does not.
- `.ts` / `.flv` / `.m3u8` direct links — no demuxer shipped.
