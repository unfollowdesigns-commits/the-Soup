# Vision assets

Fetched by `node tools/fetch-vision-assets.mjs`, not committed.

- `wasm/` — copied from the installed @mediapipe/tasks-vision package (Apache-2.0)
- `models/` — MediaPipe face_landmarker and gesture_recognizer, float16
  (Apache-2.0, Google). See https://ai.google.dev/edge/mediapipe/solutions/vision

If these are absent the vision layer says so and everything else keeps working.
