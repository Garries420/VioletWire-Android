# Third-party notices

VioletWire Android is a GPL-3.0-or-later continuation of the original
[VioletWire](https://github.com/lucaboox/VioletWire) by
[Lucaboox](https://github.com/lucaboox). The Android fork is maintained by
[Garries420](https://github.com/Garries420). Original source notices and copyright
remain in the source and Git history. See [LICENSE](LICENSE).

Third-party code, fonts, artwork and marks keep their respective licences.

## Runtime libraries and assets

| Software | Use | Licence |
| --- | --- | --- |
| [React](https://github.com/facebook/react) / React DOM | Shared interface | MIT |
| [Capacitor](https://github.com/ionic-team/capacitor) and official plugins | Android shell and native bridge | MIT |
| [AndroidX Media3 / ExoPlayer](https://github.com/androidx/media) | Native playback, media sessions, offline VOD downloads | Apache-2.0 |
| [AndroidX](https://github.com/androidx/androidx) | Android application and browser components | Apache-2.0 |
| [hls.js](https://github.com/video-dev/hls.js) | Shared web player component | Apache-2.0 |
| [Zod](https://github.com/colinhacks/zod) | Data validation | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | Interface icons | ISC |
| [flag-icons](https://github.com/lipis/flag-icons) | Country flag artwork in the shared chat renderer | MIT |
| [emoji-picker-element](https://github.com/nolanlawson/emoji-picker-element) | Unicode emoji data in the shared renderer | Apache-2.0 |
| [Inter](https://github.com/rsms/inter) | Interface font | SIL Open Font License 1.1 |

Copies of available package notices are in [docs/licenses](docs/licenses).
`package-lock.json` records exact npm dependencies. Native Maven coordinates and
versions are declared in the Android Gradle files.

## Emote providers and identifying marks

Emote data and artwork come from [7TV](https://7tv.app/),
[FrankerFaceZ](https://www.frankerfacez.com/), [BetterTTV](https://betterttv.com/)
and Twitch. Provider names and marks identify the source of emotes and remain
with their respective owners. They do not imply endorsement or affiliation.

The 7TV, FrankerFaceZ, BetterTTV and Twitch logos in the shared picker are adapted
from SVG assets in the [7TV Extension](https://github.com/SevenTV/Extension/tree/master/src/assets/svg/logos).
That repository uses [Apache-2.0 with Commons Clause](https://github.com/SevenTV/Extension/blob/master/LICENSE.md).
The original licence is included in `docs/licenses/7tv-extension.txt`.

## Stream resolution and reference projects

Android resolves Twitch and Kick streams directly using this fork's protocol
implementations. Temporary Twitch ad fallback uses independently operated
[Luminous](https://github.com/AlyoshaVasilieva/luminous-ttv) and
[Perfprod](https://github.com/younesaassila/ttv-lol-pro#credits) endpoints. These servers are external
services rather than bundled software.

[Xtra](https://github.com/crackededed/Xtra), licensed AGPL-3.0, was used as a UI,
behaviour and public protocol reference for Android controls, Twitch VOD queries
and proxy endpoint formats. This fork's Android UI, playback bridge, download,
chat replay and fallback controller were independently implemented. Xtra's app
implementation is not included.

Build tooling includes [TypeScript](https://github.com/microsoft/TypeScript),
[Vite](https://github.com/vitejs/vite), [Gradle](https://github.com/gradle/gradle)
and the Android Gradle Plugin. Their licences remain with those tools.
