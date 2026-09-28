//! Opt-in check over unpacked product course packs:
//! OLL_PACK_ROOT=<root with <packId>/<version>/course.oll.jsonl> cargo test --test course_packs
use oll_runtime::{preview::Preview, scene3d, spatial};
use std::collections::BTreeMap;

#[test]
fn every_pack_loads_plays_lays_out_and_renders_its_scenes() {
    let Ok(root) = std::env::var("OLL_PACK_ROOT") else {
        eprintln!("OLL_PACK_ROOT unset; skipping");
        return;
    };
    let mut checked = 0;
    for pack in std::fs::read_dir(&root).unwrap().flatten() {
        for version in std::fs::read_dir(pack.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            let course = version.path().join("course.oll.jsonl");
            let Ok(source) = std::fs::read_to_string(&course) else {
                continue;
            };
            let name = course.display().to_string();
            let mut p = Preview::load(&source).unwrap_or_else(|e| panic!("{name}: {e}"));
            let mut scenes = 0;
            while !p.complete() {
                p.advance().unwrap_or_else(|e| panic!("{name}: {e}"));
                p.tick(10.).unwrap();
                let sizes: BTreeMap<_, _> = p
                    .nodes
                    .iter()
                    .map(|n| (n["id"].as_str().unwrap().to_owned(), (440., 360.)))
                    .collect();
                spatial::layout(&p, &sizes).unwrap_or_else(|e| panic!("{name}: {e}"));
                for n in p.nodes.iter().filter(|n| n["kind"] == "scene3d") {
                    let c = &n["content"];
                    scene3d::render(c, scene3d::View::initial(c), &p.variables)
                        .unwrap_or_else(|e| panic!("{name}: {e}"));
                    scenes += 1;
                }
            }
            eprintln!(
                "{name}: {} actions, scene renders {scenes}",
                p.action_count()
            );
            checked += 1;
        }
    }
    assert!(checked > 0, "no course packs under {root}");
}
