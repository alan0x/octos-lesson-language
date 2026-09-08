import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
const temp = await mkdtemp(join(tmpdir(), 'oll-ai-ink-'));
const outfile = join(temp, 'probe.js');
await build({ stdin: { contents: `
import { InkRuntime } from './packages/ink-runtime/src/runtime.ts';
import { Stroke, Color4, Path, Mat33, Vec2, Erase, uniteCommands } from 'js-draw';
import { assertInkSelectionIntegrity } from './packages/ink-runtime/src/selection-record.ts';
import { inkComponentOrigin } from './packages/ink-runtime/src/component-identity.ts';
Object.assign(window, { InkRuntime, Stroke, Color4, Path, Mat33, Vec2, Erase, uniteCommands, inkComponentOrigin, assertInkSelectionIntegrity });
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', outfile });
const bundle = await readFile(outfile);
const server = createServer((req,res) => { res.setHeader('Content-Type',req.url==='/probe.js'?'text/javascript':'text/html'); res.end(req.url==='/probe.js'?bundle:'<div id="board" style="width:900px;height:700px"></div><script type="module" src="/probe.js"></script>'); });
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true, ...(process.env.OLL_BROWSER_EXECUTABLE ? { executablePath: process.env.OLL_BROWSER_EXECUTABLE } : {})});
try {
 const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForFunction(()=>window.InkRuntime);
 const result=await page.evaluate(async()=>{
  const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const viewport=document.querySelector('#board');
  const camera={panX:0,panY:0,scale:1};
  const board={setInputOwner:()=>{},getCameraState:()=>camera,subscribeCamera:(fn)=>{fn(camera);return()=>{};},viewportToBoard:p=>p};
  const mount=()=>window.InkRuntime.mount({board,viewport,storageKey:'probe',documentId:'probe',autosaveDelayMs:10});
  let ink=mount();await ink.ready;
  check(await ink.writeAiPaths('turn-A',['M20 20 L100 20 L100 40 L20 40 Z']),'first write');
  check(ink.state.component_count===1,'one component');
  check(window.inkComponentOrigin(ink.editor.image.getAllComponents().find(c=>c.isSelectable()))==='ai','origin');
  check(!await ink.writeAiPaths('turn-A',['M1 1 L2 1 L2 2 Z']),'no duplicate');
  await ink.undo();await ink.saveNow();
  check(ink.state.component_count===0,'undo');
  check(!await ink.writeAiPaths('turn-A',['M1 1 L2 1 L2 2 Z']),'undo not resurrected');
  await ink.redo();await ink.saveNow();check(ink.state.component_count===1,'redo');
  await ink.destroy();ink=mount();await ink.ready;
  check(ink.state.component_count===1,'restored component');
  check(window.inkComponentOrigin(ink.editor.image.getAllComponents().find(c=>c.isSelectable()))==='ai','restored origin '+JSON.stringify(ink.editor.image.getAllComponents().map(c=>c.getLoadSaveData()))+' SVG '+localStorage.getItem('probe'));
  check(!await ink.writeAiPaths('turn-A',['M1 1 L2 1 L2 2 Z']),'restored ledger');
  // Playback uses an empty document; restoring merges ink and consumed IDs.
  await ink.destroy();
  const playback=window.InkRuntime.mount({board,viewport,storageKey:'replay',documentId:'replay'});
  await playback.ready;check(playback.state.component_count===0,'playback hides original ink');
  await playback.mergeSavedDocument('probe','probe');
  check(playback.state.component_count===1,'playback restores original ink');
  check(!await playback.writeAiPaths('turn-A',['M1 1 L2 1 L2 2 Z']),'playback restores consumption ledger');
  await playback.destroy();ink=mount();await ink.ready;
  // Exercise real js-draw editing, including its fresh-stroke partial eraser.
  const originalStroke=ink.editor.image.getAllComponents().find(c=>c.isSelectable());
  const idOf=c=>c.getLoadSaveData().svgAttrs.find(a=>a[0]==='data-octos-ink-component-id')[1];
  const originalId=idOf(originalStroke);
  await ink.editor.dispatch(originalStroke.transformBy(window.Mat33.translation(window.Vec2.of(15,0))));
  check(idOf(originalStroke)===originalId && window.inkComponentOrigin(originalStroke)==='ai','move preserves identity and origin');
  const copy=originalStroke.clone();
  check(idOf(copy)!==originalId && window.inkComponentOrigin(copy)==='ai','copy gets new identity and keeps origin');
  const parts=originalStroke.withRegionErased(window.Path.fromString('M60 10 L70 10 L70 50 L60 50 Z'),ink.editor.viewport);
  check(parts.length>0 && !parts.includes(originalStroke),'partial eraser actually split ink');
  check(parts.every(p=>window.inkComponentOrigin(p)==='ai'),'erased descendants preserve origin');
  check(new Set(parts.map(idOf)).size===parts.length && parts.every(p=>idOf(p)!==originalId),'erased descendants have unique IDs');
  await ink.editor.dispatch(window.uniteCommands([new window.Erase([originalStroke]),...parts.map(p=>ink.editor.image.addComponent(p))]));
  await ink.saveNow();await ink.undo();await ink.redo();await ink.saveNow();
  await ink.destroy();ink=mount();await ink.ready;
  check(ink.editor.image.getAllComponents().filter(c=>c.isSelectable()).every(c=>window.inkComponentOrigin(c)==='ai'),'erased descendants survive undo redo reload');
  // Capture A while save is deliberately delayed; switch selection to B.
  const a=ink.editor.image.getAllComponents().find(c=>c.isSelectable());
  const b=window.Stroke.fromFilled('M200 200 L240 200 L240 240 Z',window.Color4.red);
  ink.selectedComponents=[a];
  const original=ink.saveNow.bind(ink);let release;
  ink.saveNow=()=>new Promise(r=>{release=r;});
  const capture=ink.captureSelectionSnapshot();ink.selectedComponents=[b];release(null);
  const snapshot=await capture;check(snapshot.bounds.x<100,'capture frozen before save');
  check(snapshot.format_version===5,'AI selection uses v5');
  check(snapshot.component_origins.every(origin=>origin==='ai'),'AI selection origins');
  await window.assertInkSelectionIntegrity(snapshot);
  let integrityRejected=false;
  try {await window.assertInkSelectionIntegrity({...snapshot,component_origins:['student']});} catch {integrityRejected=true;}
  check(integrityRejected,'origin tampering rejected');
  ink.saveNow=original;await ink.destroy();
  // A failed storage write must retry persistence without duplicating paths.
  let saved=null,fail=false;
  const store={load:()=>saved,save:(_key,record)=>{if(fail)throw new Error('injected storage failure');saved=structuredClone(record);}};
  const mountFault=()=>window.InkRuntime.mount({board,viewport,storageKey:'fault',documentId:'fault',store,autosaveDelayMs:10000});
  ink=mountFault();await ink.ready;fail=true;
  let rejected=false;
  try {await ink.writeAiPaths('fault-A',['M20 20 L100 20 L100 40 Z']);}catch{rejected=true;}
  check(rejected && saved===null,'failed write is not persisted');
  check(ink.state.component_count===1,'failed save retains whole visible transaction');
  fail=false;check(!await ink.writeAiPaths('fault-A',['M1 1 L2 1 L2 2 Z']),'save retry does not duplicate');
  check(saved.format_version===2,'AI document rejects legacy writers');
  await ink.undo();await ink.saveNow();await ink.destroy();
  ink=mountFault();await ink.ready;
  check(ink.state.component_count===0,'undo persists across reload');
  check(!await ink.writeAiPaths('fault-A',['M1 1 L2 1 L2 2 Z']),'reload does not refill undone writing');
  await Promise.all([ink.writeAiPaths('parallel-A',['M1 1 L2 1 L2 2 Z']),ink.writeAiPaths('parallel-B',['M3 3 L4 3 L4 4 Z'])]);
  check(ink.state.component_count===2,'concurrent distinct transactions persist');
  await ink.destroy();ink=mountFault();await ink.ready;
  check(ink.state.component_count===2,'concurrent transactions reload');
  check(!await ink.writeAiPaths('parallel-A',['M1 1 L2 1 L2 2 Z']),'parallel ledger preserved');
  await ink.destroy();
  return {passed:['write','origin','idempotency','undo','redo','reload','capture during save','v5 integrity','save failure retry','undo reload','concurrent writers','legacy write protection','move','copy','partial erase undo redo reload']};
 });
 const move = await page.evaluate(async () => {
   const viewport=document.querySelector('#board'), camera={panX:0,panY:0,scale:1};
   const board={setInputOwner:()=>{},getCameraState:()=>camera,subscribeCamera:fn=>{fn(camera);return()=>{};},viewportToBoard:p=>p};
   const ink=window.InkRuntime.mount({board,viewport,storageKey:'pointer-move',documentId:'pointer-move'});
   await ink.ready;await ink.writeAiPaths('move',['M200 200 L350 200 L350 280 L200 280 Z']);
   ink.setMode('select');window.pointerInk=ink;
   const bounds=viewport.getBoundingClientRect();
   return {left:bounds.x,top:bounds.y,before:ink.state.content_bounds.x};
 });
 await page.mouse.move(move.left+180,move.top+180);await page.mouse.down();
 await page.mouse.move(move.left+370,move.top+300,{steps:8});await page.mouse.up();
 const selected = await page.evaluate(() => window.pointerInk.state);
 if(selected.selected_count!==1 || !selected.selection_transform_enabled) {
   throw new Error('gesture-created selection is not directly draggable: '+JSON.stringify(selected));
 }
 await page.evaluate(async () => {
   const ink=window.pointerInk;
   window.pointerSource=await ink.captureSelectionSnapshot();
   window.geometryUpdates=0;
   ink.subscribeGeometry(()=>{window.geometryUpdates+=1;});
 });
 move.x=move.left+260;move.y=move.top+240;
 await page.mouse.move(move.x,move.y);await page.mouse.down();await page.mouse.move(move.x+70,move.y+40,{steps:8});
 await page.waitForTimeout(32);
 const duringMove=await page.evaluate(()=>({
   updates:window.geometryUpdates,
   bounds:window.pointerInk.getSelectionSourceBounds(window.pointerSource),
 }));
 if(duringMove.updates<1 || duringMove.bounds.x<move.before+60) {
   throw new Error('source bounds did not update during pointer drag: '+JSON.stringify(duringMove));
 }
 await page.mouse.up();
 await page.evaluate(async ({before}) => {
   const ink=window.pointerInk;
   if(ink.state.content_bounds.x < before+60) throw new Error('direct pointer drag did not move selected ink');
   if(ink.getSelectionSourceBounds(window.pointerSource).x < before+60) throw new Error('moved source bounds were not retained');
   await ink.undo();await ink.saveNow();
   if(Math.abs(ink.state.content_bounds.x-before)>1) throw new Error('pointer move undo');
   const undoneSource=ink.getSelectionSourceBounds(window.pointerSource);
   if(Math.abs(undoneSource.x-window.pointerSource.bounds.x)>1) {
     throw new Error('source bounds did not follow undo: '+JSON.stringify({expected:window.pointerSource.bounds,undoneSource,state:ink.state}));
   }
   await ink.destroy();
 }, move);
 result.passed.push('live source bounds','direct pointer drag and undo','playback merge');
 console.log(JSON.stringify(result));
} finally {await browser.close();server.close();await rm(temp,{recursive:true,force:true});}
