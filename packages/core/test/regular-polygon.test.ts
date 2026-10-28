import test from "node:test";
import assert from "node:assert/strict";
import { regularPolygonGeometry } from "../src/regular-polygon.js";
import { assertAuthoringSchema, normalizeAuthoringLesson, reduceCanonicalEvents, setLessonVariable, deriveExecutionRequirements, assertExecutionSupported } from "../src/index.js";

test("3..384 sides preserve a fixed circle, tangency, equal edges and converging perimeter bounds", () => {
  let priorLower = 0, priorUpper = Infinity;
  for (let n = 3; n <= 384; n++) {
    const center = { x: 2.3, y: -4.1 }, r = 3.7;
    const inside = regularPolygonGeometry(center, r, n, "inscribed", .37);
    const outside = regularPolygonGeometry(center, r, n, "circumscribed", .37);
    assert.equal(inside.vertices.length, n);
    for (const shape of [inside, outside]) {
      const lengths = shape.vertices.map((a, i) => {
        const b = shape.vertices[(i + 1) % n]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const distance = Math.abs((b.x-a.x)*(center.y-a.y)-(b.y-a.y)*(center.x-a.x))/length;
        if (shape === outside) assert.ok(Math.abs(distance-r)<1e-10);
        else assert.ok(Math.abs(Math.hypot(a.x-center.x,a.y-center.y)-r)<1e-10);
        return length;
      });
      assert.ok(lengths.every(x=>Math.abs(x-lengths[0]!)<1e-10));
      assert.ok(Math.abs(lengths.reduce((a,b)=>a+b,0)-shape.perimeter)<1e-9);
    }
    assert.ok(inside.perimeterOverDiameter < Math.PI && outside.perimeterOverDiameter > Math.PI);
    assert.ok(inside.perimeterOverDiameter > priorLower && outside.perimeterOverDiameter < priorUpper);
    priorLower=inside.perimeterOverDiameter;priorUpper=outside.perimeterOverDiameter;
  }
  assert.ok(Math.abs(regularPolygonGeometry({x:0,y:0},2,96,"inscribed").perimeterOverDiameter-3.1410319508905093)<1e-12);
  assert.ok(Math.abs(regularPolygonGeometry({x:0,y:0},2,96,"circumscribed").perimeterOverDiameter-3.142714599645368)<1e-12);
  assert.equal(regularPolygonGeometry({x:0,y:0},2,12.4,"inscribed").sides,12);
  for (const n of [2,385,Infinity,NaN]) assert.throws(()=>regularPolygonGeometry({x:0,y:0},2,n,"inscribed"));
});

test("regular polygons validate, normalize, bind, restore deterministically and require a capable player", () => {
  const lesson: any = {dsl:"octos.lesson",version:"0.1",profile:"authoring",lesson:{mode:"explain",language:"zh-CN",title:"Polygon",goals:["Bounds"],variables:[{as:"n",initial:6,min:3,max:384,control:{kind:"slider",step:1}}]},steps:[{key:"s",purpose:"Bounds",beats:[{key:"b",say:"Bounds",actions:[{do:"write",as:"g",kind:"geometry",role:"main_visual",place:{relation:"new_region"},content:{axes:{x:{min:-3,max:3},y:{min:-3,max:3},equal_scale:true},points:[{as:"o",x:0,y:0}],circles:[{as:"c",center:"o",radius:2}],regular_polygons:[{as:"p",center:"o",radius:2,sides:6,relation:"inscribed",show_measurements:true}],bindings:[{target:"p.sides",expression:"round(n)"}]}}]}]}]};
  lesson.close = { summary: "Bounds", focus: ["g"] };
  assertAuthoringSchema(lesson);
  const events=normalizeAuthoringLesson(lesson,{lessonId:"p",boardId:"b",baseRevision:0,regionIntent:"new_topic",regionId:"r"});
  assert.equal(deriveExecutionRequirements(events).minimumPlayerVersion,"0.4.0");
  assert.throws(()=>assertExecutionSupported(events,"0.3.0"));
  const state=setLessonVariable(reduceCanonicalEvents(events),"n",96);
  const shape=state.nodes["p:node:g"]!.content.regular_polygons[0];
  assert.equal(shape.center,"p:node:g:fragment:o");assert.equal(shape.sides,96);
  assert.deepEqual(setLessonVariable(reduceCanonicalEvents(events),"n",96),state);
  const geometry=(lesson.steps[0].beats[0].actions[0] as any).content;
  for(const sides of [2,6.5,385]) {geometry.regular_polygons[0].sides=sides;assert.throws(()=>normalizeAuthoringLesson(lesson,{lessonId:"p",boardId:"b",baseRevision:0,regionIntent:"new_topic",regionId:"r"}));}
});
