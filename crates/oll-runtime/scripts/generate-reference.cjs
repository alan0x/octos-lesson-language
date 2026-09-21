// Generate oracle data using the existing TypeScript implementation, not a second port.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'../../..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'oll-rust-reference-'));
try {
 const bundle=path.join(tmp,'reference.cjs');
 esbuild.buildSync({stdin:{contents:'export { compilePlaybackOperations, HeadlessLessonPlayer } from "./packages/player-core/src/index.ts"; export { operationDelay, narrationDuration, BrowserLessonSession } from "./packages/web-runtime/src/runtime.ts";',resolveDir:root},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 const ref=require(bundle);
 const events=fs.readFileSync(path.join(root,'examples/unit-circle-sine/lesson.canonical.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const ops=ref.compilePlaybackOperations(events);
 const samples=[['中文，慢慢读。','patient'],["Let's compare x=3.14 and y=-2!",'careful'],['ひらがな カタカナ 한글 漢字','neutral'],['😀 π²+√9。','emphatic'],['𠀀 e\u0301 — 6÷2','encouraging'],['','neutral'],['长'.repeat(500),'patient']];
 const player=new ref.HeadlessLessonPlayer(events);while(player.status!=='completed')player.advance();
 const saved={now:Date.now,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
 let clock=0, nextId=0, lastCursor=0;const timers=new Map(),timeline=[];
 try {
  Date.now=()=>clock;global.setTimeout=(fn,ms)=>{const id=++nextId;timers.set(id,{fn,time:clock+ms});return id;};global.clearTimeout=id=>timers.delete(id);
  const session=new ref.BrowserLessonSession(events,{load(){},save(){},remove(){}},'rust-reference');
  session.subscribe(()=>{const cursor=session.projection.cursor;if(cursor!==lastCursor){timeline.push({cursor,ms:clock,type:session.currentOperation.type});lastCursor=cursor;}});
  session.play();let iterations=0;
  while(timers.size){if(++iterations>10000)throw Error('Timer loop');const [id,t]=[...timers].sort((a,b)=>a[1].time-b[1].time)[0];timers.delete(id);clock=t.time;t.fn();}
  if(session.status!=='completed')throw Error('Reference did not complete');
 } finally {Date.now=saved.now;global.setTimeout=saved.setTimeout;global.clearTimeout=saved.clearTimeout;}
 const output={timeline,source:'TypeScript main 2b93d67',operations:ops,delays_ms:ops.map(o=>ref.operationDelay(o)),narrations:samples.map(([text,delivery])=>({text,delivery,ms:ref.narrationDuration(text,delivery)})),course_narration_ms:ref.narrationDuration(events[1].step.beats[0].narration.text,events[1].step.beats[0].narration.delivery),final_state:player.finalState()};
 fs.writeFileSync(path.join(root,'crates/oll-runtime/tests/fixtures/typescript-reference.json'),JSON.stringify(output,null,2)+'\n');
 const quadraticEvents=fs.readFileSync(path.join(root,'examples/quadratic/lesson.canonical.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const quadraticPlayer=new ref.HeadlessLessonPlayer(quadraticEvents), states=[];
 while(quadraticPlayer.status!=='completed'){
   const frame=quadraticPlayer.advance();
   if(frame.operation.type==='action.apply')states.push(frame.projection.board);
 }
 fs.writeFileSync(path.join(root,'crates/oll-runtime/tests/fixtures/quadratic-reference.json'),JSON.stringify({operations:ref.compilePlaybackOperations(quadraticEvents),states,final_state:quadraticPlayer.finalState()},null,2)+'\n');
 console.log(`Generated ${ops.length} operations and ${samples.length} narration cases`);
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
