# Science transpiration V2 acceptance

Date: 2026-07-27

Viewport: 1280 × 720, real Chrome playback harness, deterministic action and Beat observation.

## Result

The lesson passes the third teaching-comprehensibility vertical slice and the
first controlled-image slice. It uses the unchanged OLL v0.1 language surface:
OLL names an `asset_id` and authorized regions, while the host Runtime resolves
the URL, intrinsic size and normalized region bounds.

## Keyframes

| Beat | Durable board change | Epistemic boundary |
| --- | --- | --- |
| show-experiment-and-question | real comparison image and question | no transpiration answer yet |
| observe-left-droplets | first evidence-table row | direct observation only |
| compare-leafless-control | second evidence-table row | comparison precedes inference |
| infer-leaf-relationship | leaf-related inference | explicitly not the hidden mechanism |
| absorb-water-through-roots | two-stage water path | model begins after evidence |
| transport-water-to-leaves | four-stage water path | stem transport appears separately |
| release-water-vapor | six-stage path and term transpiration | vapor is distinguished from droplets |
| condense-on-bag | condensation route | visible droplets get a separate cause |
| return-to-experiment | model explains both setups | explanation is checked against evidence |
| separate-evidence-and-model | observation/inference/mechanism table | three knowledge layers stay distinct |
| show-complete-route | inquiry route and takeaway | lesson can be retold from evidence to model |

## Automated evidence

- The controlled PNG exists in the repository and resolves through the host asset catalog.
- All normalized region bounds remain inside the image coordinate space.
- Browser observation waits for each lesson image to finish loading and rejects pending or failed assets.
- Image-region emphasis targets real overlays on the loaded image.
- Evidence-table rows progress exactly 1 → 2 before inference appears.
- Water-path stages progress exactly 2 → 4 → 6 before condensation appears.
- Full repository suite: 60 tests passed.
- Real Chrome Observer: 11/11 Beat keyframes and 37/37 action frames passed.
- Geometry and quadratic positive baselines still pass after the Runtime change.

## Browser defect found and fixed

The first Chrome run failed `return-to-experiment`: the source image was at the
top-left of the board while the new explanation card was at the lower-right.
Focusing both forced the camera to scale 0.5 and reduced the image to 123 px.
The explanation card now sits directly below its evidence image. The corrected
Beat renders at scale 1 with a 249 px minimum focused card; the threshold was not lowered.

## Architecture conclusion

No OLL protocol change was needed. Resource authorization remains in Session
Context, Canonical nodes retain stable region references, and the frontend host
owns transport-specific resolution. A production Runtime can replace the local
catalog with signed URLs without teaching semantics learning about storage.

The next positive specimen should cover language or humanities with addressable
text evidence. After that visual cross-subject gate, TTS timing and writing
animation become the next Runtime boundary.
