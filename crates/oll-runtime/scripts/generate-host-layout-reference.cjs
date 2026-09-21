const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'../../..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'oll-host-layout-'));
try{const bundle=path.join(tmp,'ref.cjs');esbuild.buildSync({entryPoints:[path.join(root,'packages/web-runtime/src/layout.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});const {computeBoardLayout}=require(bundle);const cases=[];
for(const flow of ['semantic','reading'])for(const host of [false,true])for(const attachment of [false,true]){
 const nodes={a:{id:'a',kind:'geometry',region_id:'one',placement:{relation:'new_region'}},intro:{id:'intro',kind:'note',region_id:'one',placement:{relation:'below',anchor:'a'}},b:{id:'b',kind:'plot',region_id:'one',placement:{relation:'new_region'}},c:{id:'c',kind:'math',region_id:'two',placement:{relation:'new_region'}}};
 for(let i=0;i<8;i++)nodes['n'+i]={id:'n'+i,kind:'text',region_id:i<6?'one':'two',placement:{relation:'new_region'}};
 const state={nodes,groups:{g:{id:'g',members:['a','b']}},connections:{ab:{id:'ab',from:{node_id:'a'},to:{node_id:'b'}}}};
 const sizes=Object.fromEntries(Object.values(nodes).map(n=>[n.id,{width:['geometry','plot'].includes(n.kind)?440:320,height:['geometry','plot'].includes(n.kind)?390:145}]));
 const options=host?{regions:{one:{x:30,y:60,reservedWidth:1100,flow,obstacles:[{x:400,y:40,width:180,height:80}],attachments:attachment?[{id:'control',anchorNodeId:'b',anchorNodeIds:['a','b'],width:700,height:130}]:[]},two:{x:1500,y:60,reservedWidth:760,flow}}}:{};
 cases.push({state,sizes,options,expected:computeBoardLayout(state,sizes,options)});
}
fs.writeFileSync(path.join(root,'crates/oll-runtime/tests/fixtures/host-layout-reference.json'),JSON.stringify(cases,null,2)+'\n');}finally{fs.rmSync(tmp,{recursive:true,force:true});}
