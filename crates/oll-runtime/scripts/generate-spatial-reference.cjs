// Execute the existing Web implementation as the oracle. No DOM required.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'../../..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'oll-spatial-'));
try {
 const bundle=path.join(tmp,'reference.cjs');
 esbuild.buildSync({stdin:{contents:'export {computeBoardLayout} from "./packages/web-runtime/src/layout.ts"; export {planFocusCamera} from "./packages/web-runtime/src/camera.ts"; export {HeadlessLessonPlayer} from "./packages/player-core/src/index.ts";',resolveDir:root},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter),outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 const ref=require(bundle),courses=[];
 for(const course of ['quadratic','unit-circle-sine']){
   const events=fs.readFileSync(path.join(root,`examples/${course}/lesson.canonical.jsonl`),'utf8').trim().split('\n').map(JSON.parse);
   const player=new ref.HeadlessLessonPlayer(events),frames=[];
   while(player.status!=='completed'){
     const frame=player.advance();if(frame.operation.type!=='action.apply')continue;
     const sizes=Object.fromEntries(Object.values(frame.projection.board.nodes).map(n=>[n.id,{width:n.kind==='math'?360:n.kind==='note'?380:440,height:n.kind==='math'?112:n.kind==='note'?140:390}]));
     frames.push({sizes,layout:ref.computeBoardLayout(frame.projection.board,sizes)});
   }
   courses.push({course,frames});
 }
 const cameras=[];
 for(const mode of ['detail','relationship','overview','course'])for(const viewport of [{width:1160,height:490},{width:760,height:600}]){
   const targets=[{x:120,y:180,width:440,height:390},{x:620,y:260,width:320,height:140}];
   cameras.push({mode,viewport,targets,expected:ref.planFocusCamera(targets,{panX:0,panY:0,scale:1},viewport,mode)});
 }
 fs.writeFileSync(path.join(root,'crates/oll-runtime/tests/fixtures/spatial-reference.json'),JSON.stringify({courses,cameras},null,2)+'\n');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
