//! Host narration audio drives the Beat's narration end.
use oll_runtime::session::Session;
const CIRCLE: &str = include_str!("../../../examples/unit-circle-sine/lesson.canonical.jsonl");

fn first_narration(s: &mut Session) -> String {
    s.play().unwrap();
    for _ in 0..2000 {
        if let Some((beat, _)) = s.narration_position() {
            return beat.to_owned();
        }
        s.tick(0.01).unwrap();
    }
    panic!("no narration");
}

#[test]
fn a_longer_clip_holds_the_beat_until_the_audio_finishes() {
    let mut s = Session::load(CIRCLE).unwrap();
    let beat = first_narration(&mut s);
    // Audio is 60s long: far beyond any estimate. Advance 30s of wall time
    // while the clip reports its position.
    let mut pos = 0.;
    for _ in 0..3000 {
        pos += 10.;
        s.sync_narration_audio(&beat, pos, 60_000., false);
        s.tick(0.01).unwrap();
    }
    assert_eq!(s.narration_position().map(|(b, _)| b.to_owned()), Some(beat.clone()), "narration released before the audio ended");
    // The clip finishes: the narration ends on the next tick.
    s.sync_narration_audio(&beat, 60_000., 60_000., true);
    s.tick(0.02).unwrap();
    assert_ne!(s.narration_position().map(|(b, _)| b.to_owned()), Some(beat));
}

#[test]
fn a_shorter_clip_releases_the_beat_without_waiting_for_the_estimate() {
    // Baseline: the declared / estimated narration time.
    let ticks_until_release = |audio: bool| {
        let mut s = Session::load(CIRCLE).unwrap();
        let beat = first_narration(&mut s);
        for i in 1..20_000 {
            if audio {
                // A 300ms clip that has finished.
                let finished = i * 10 >= 300;
                s.sync_narration_audio(&beat, (i * 10).min(300) as f64, 300., finished);
            }
            s.tick(0.01).unwrap();
            if s.narration_position().map(|(b, _)| b.to_owned()) != Some(beat.clone()) {
                return i;
            }
        }
        panic!("never released");
    };
    let estimated = ticks_until_release(false);
    let with_audio = ticks_until_release(true);
    assert!(with_audio < estimated, "audio {with_audio} vs estimate {estimated}");
}
