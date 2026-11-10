# Voice and platform findings

Browser voice is a required component of the prototype, not a later optional integration. SpeechRecognition is not universally supported. MDN explicitly warns that Chrome may send audio to a recognition web service and may not work offline. The app should use feature detection, begin listening only on an explicit click, show listening and error states, allow stopping, and place recognised text into an editable draft before saving. Keyboard dictation remains an honest fallback on unsupported embedded browsers. Do not call browser dictation fully private or guarantee Android WebView support.

SpeechSynthesis is widely available. Provide user-triggered read-aloud of the attention summary and next action with stop controls, without reading automatically. No external TTS account is needed for this prototype. Device voice availability varies.

A PWA can use a service worker to cache its shell and work offline after loading online. Service workers are event-driven, not permanently running schedulers. Exact closed-app alarms cannot be promised using an in-page timer. This prototype should recompute relevance while open and upon reopening, and explicitly reserve reliable push, cloud sync and external integrations for a later application decision.

Local task persistence plus JSON/CSV export is a portable baseline. Browser storage is not a backup and is per origin/browser/device; clearing site data removes it. Prototype tasks should be clearly labelled sample data and sandbox experiments should not replace a personal collection.

## Sources

[1]: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition "MDN SpeechRecognition"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis "MDN SpeechSynthesis"
[3]: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation "MDN Offline and background operation"
