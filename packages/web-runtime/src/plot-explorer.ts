import { compilePlotExpression, type PlotRange } from "./plot.js";

type Ranges = {x:PlotRange;y:PlotRange};
type State = {ranges:Ranges;signature:string;exploring:boolean;hidden:Set<number>;dialog?:HTMLDialogElement;gesture?:{host:HTMLElement;pointers:Map<number,{x:number;y:number}>};draw?:()=>void};
const states=new WeakMap<HTMLElement,State>();
export function zoomPlotRanges(ranges:Ranges,factor:number,anchor={x:.5,y:.5}):Ranges {
  const axis=(r:PlotRange,t:number)=>{
    const span=r.max-r.min, next=span*factor, center=r.min+span*t;
    if(!Number.isFinite(next)||next<1e-7||next>1e9)return {...r};
    const min=center-next*t,max=center+next*(1-t);
    return Math.abs(min)>1e12||Math.abs(max)>1e12?{...r}:{min,max};
  };
  return {x:axis(ranges.x,anchor.x),y:axis(ranges.y,anchor.y)};
}
export function panPlotRanges(ranges:Ranges,dx:number,dy:number):Ranges {
  return {x:{min:ranges.x.min+dx,max:ranges.x.max+dx},y:{min:ranges.y.min+dy,max:ranges.y.max+dy}};
}

/** View-only state stays out of lesson variables, model input and replay events. */
export function renderPlotExplorer(parent:HTMLElement,node:Record<string,any>,variables:Record<string,number>,
  draw:(host:HTMLElement,node:Record<string,any>,variables:Record<string,number>,width:number,height:number)=>void):void {
  const axes=node.content?.axes??{};
  const valid=(r:any):PlotRange=>r&&Number.isFinite(r.min)&&Number.isFinite(r.max)&&r.min<r.max?{min:r.min,max:r.max}:{min:-5,max:5};
  const recommended={x:valid(axes.x),y:valid(axes.y)};
  const curves:any[]=node.content?.curves??[];
  const signature=JSON.stringify({axes,curves:curves.map(c=>[c.id,c.expression])});
  const storageKey=parent.dataset.plotViewScope?`oll.plot.view.v1:${parent.dataset.plotViewScope}:${node.id}`:undefined;
  let state=states.get(parent);
  if(!state||state.signature!==signature){
    const previousDialog=state?.dialog;
    state={ranges:structuredClone(recommended),signature,exploring:false,hidden:new Set(),dialog:previousDialog};
    if(storageKey)try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(saved?.signature===signature&&saved.ranges){
      state.ranges={x:valid(saved.ranges.x),y:valid(saved.ranges.y)};
    }}catch{}
    states.set(parent,state);
  }
  const current=state;
  const evaluators=curves.map(c=>{try{return c.kind==='implicit'?undefined:compilePlotExpression(c.expression,variables);}catch{return undefined;}});
  const surfaces:Array<{body:HTMLElement;large:boolean}>=[];
  const save=()=>{if(storageKey)try{sessionStorage.setItem(storageKey,JSON.stringify({signature,ranges:current.ranges}));}catch{}};
  const toolbar=document.createElement('div'); toolbar.className='plot-toolbar';
  toolbar.dataset.ollBoardInput='ignore';toolbar.dataset.ollInkInput='ignore';
  const button=(label:string,title:string,action:()=>void)=>{
    const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);b.onclick=action;toolbar.append(b);return b;
  };
  const refresh=()=>{save();for(const s of surfaces)paint(s.body,s.large);};
  let queued=false;
  const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;refresh();});};
  button('+','放大坐标范围中的局部',()=>{current.ranges=zoomPlotRanges(current.ranges,.8);refresh();});
  button('−','缩小图像以查看更多坐标',()=>{current.ranges=zoomPlotRanges(current.ranges,1.25);refresh();});
  const explore=button('探索','切换图内平移和缩放',()=>{current.exploring=!current.exploring;explore.setAttribute('aria-pressed',String(current.exploring));refresh();});
  explore.setAttribute('aria-pressed',String(current.exploring));
  button('课程视图','恢复课程视窗和图层，保留参数',()=>{current.ranges=structuredClone(recommended);current.hidden.clear();refresh();});
  const expand=button('大图','放大查看函数图',()=>{
    if(current.dialog)return;
    const dialog=document.createElement('dialog');dialog.className='oll-plot-dialog';current.dialog=dialog;
    document.body.append(dialog);mountDialog(dialog);dialog.showModal();
    dialog.addEventListener('close',()=>{current.dialog=undefined;dialog.remove();expand.focus();},{once:true});
  });
  parent.append(toolbar);
  const body=document.createElement('div');body.className='plot-explorer-body';parent.append(body);surfaces.push({body,large:false});
  function mountDialog(dialog:HTMLDialogElement){
    dialog.replaceChildren();
    const close=document.createElement('button');close.textContent='关闭大图';close.type='button';close.onclick=()=>dialog.close();dialog.append(close);
    const title=document.createElement('h2');title.textContent=node.content?.title??'函数图';dialog.append(title);
    const controls=toolbar.cloneNode(true) as HTMLElement;
    const original=Array.from(toolbar.querySelectorAll('button'));
    controls.querySelectorAll('button').forEach((b,i)=>{b.onclick=()=>original[i]?.click();});dialog.append(controls);
    const shell=document.createElement('div');shell.className='oll-board-runtime plot-dialog-shell';
    const body=document.createElement('div');shell.append(body);dialog.append(shell);surfaces.push({body,large:true});paint(body,true);
  }
  function paint(host:HTMLElement,large:boolean){
    if(!host.isConnected && host!==body)return;
    host.replaceChildren();
    host.dataset.ollBoardInput=current.exploring?'ignore':'';host.dataset.ollInkInput=current.exploring?'ignore':'';
    const width=large?Math.max(300,Math.min(1000,window.innerWidth-80)):300, height=large?Math.max(200,Math.min(520,window.innerHeight-220)):150;
    const content={...node.content,axes:{...axes,...current.ranges},curves:curves.map((c,i)=>({...c,plotSeries:i})).filter((_,i)=>!current.hidden.has(i))};
    draw(host,{...node,content},variables,width,height);
    host.querySelector('.plot-legend')?.remove();
    const legend=document.createElement('div');legend.className='plot-legend';legend.dataset.ollBoardInput='ignore';legend.dataset.ollInkInput='ignore';
    curves.forEach((c,i)=>{const label=document.createElement('label');label.className=`plot-legend-item plot-series-${i%6}`;
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=!current.hidden.has(i);
      checkbox.onchange=()=>{checkbox.checked?current.hidden.delete(i):current.hidden.add(i);refresh();};
      label.append(checkbox,document.createTextNode(c.label||c.expression));legend.append(label);
    });host.append(legend);
    if(current.hidden.size){const notice=document.createElement('div');notice.className='plot-control-hint';notice.textContent='部分曲线已隐藏；练习前请恢复课程视图。';host.append(notice);}
    const readout=document.createElement('output');readout.className='plot-probe-readout';readout.textContent=current.exploring?'探索中：拖动空白平移，滚轮/双指缩放。':'指向曲线查看坐标';host.append(readout);
    const svg=host.querySelector('svg') as SVGSVGElement|null;if(!svg)return;
    svg.style.touchAction=current.exploring?'none':'';svg.setAttribute('tabindex','0');svg.setAttribute('aria-label','函数图；探索模式可平移缩放');
    const anchor=(event:PointerEvent|WheelEvent)=>{const rect=svg.getBoundingClientRect();return {
      x:Math.max(0,Math.min(1,( (event.clientX-rect.left)/rect.width*width-30)/(width-42))),
      y:Math.max(0,Math.min(1,1-((event.clientY-rect.top)/rect.height*height-10)/(height-34))),
    };};
    svg.addEventListener('wheel',event=>{if(!current.exploring)return;event.preventDefault();event.stopPropagation();current.ranges=zoomPlotRanges(current.ranges,event.deltaY>0?1.12:1/1.12,anchor(event));schedule();},{passive:false});
    // Pointer capture lives on the persistent host: redraws do not lose the gesture.
    svg.onpointerdown=event=>{if(!current.exploring)return;event.preventDefault();event.stopPropagation();host.setPointerCapture(event.pointerId);
      if(current.gesture?.host!==host)current.gesture={host,pointers:new Map()};
      current.gesture.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});};
    host.onpointermove=event=>{
      const gesture=current.gesture;
      if(gesture?.host===host&&gesture.pointers.has(event.pointerId)&&current.exploring){
        const previous=gesture.pointers.get(event.pointerId)!;
        const before=[...gesture.pointers.values()];
        gesture.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        const after=[...gesture.pointers.values()];
        if(before.length===2){
          const distance=(p:typeof before)=>Math.hypot(p[0]!.x-p[1]!.x,p[0]!.y-p[1]!.y);
          const a=distance(before),b=distance(after);
          const rect=svg.getBoundingClientRect();
          const center={x:((after[0]!.x+after[1]!.x)/2-rect.left)/rect.width,y:1-((after[0]!.y+after[1]!.y)/2-rect.top)/rect.height};
          if(a>1&&b>1)current.ranges=zoomPlotRanges(current.ranges,a/b,center);
        } else {
          const rect=svg.getBoundingClientRect();
          const dx=(previous.x-event.clientX)/rect.width*width/(width-42)*(current.ranges.x.max-current.ranges.x.min);
          const dy=(event.clientY-previous.y)/rect.height*height/(height-34)*(current.ranges.y.max-current.ranges.y.min);
          const next=panPlotRanges(current.ranges,dx,dy);
          if([next.x.min,next.x.max,next.y.min,next.y.max].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e12))current.ranges=next;
        }
        schedule();return;
      }
      const point=anchor(event),x=current.ranges.x.min+point.x*(current.ranges.x.max-current.ranges.x.min);
      const candidates=evaluators.flatMap((f,i)=>{if(!f||current.hidden.has(i))return [];let y;try{y=f(x);}catch{return [];}
        return Number.isFinite(y)&&y>=current.ranges.y.min&&y<=current.ranges.y.max?[{i,y,distance:Math.abs((y-current.ranges.y.min)/(current.ranges.y.max-current.ranges.y.min)-point.y)}]:[];});
      candidates.sort((a,b)=>a.distance-b.distance);const hit=candidates[0];
      svg.querySelectorAll('[data-plot-probe]').forEach(e=>e.remove());
      if(hit){const px=30+point.x*(width-42),py=height-24-(hit.y-current.ranges.y.min)/(current.ranges.y.max-current.ranges.y.min)*(height-34);
        for(const coordinates of [[px,10,px,height-24],[30,py,width-12,py]]){
          const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.dataset.plotProbe='true';
          ['x1','y1','x2','y2'].forEach((key,i)=>line.setAttribute(key,String(coordinates[i])));
          line.setAttribute('stroke','#7b8d88');line.setAttribute('stroke-dasharray','3 3');line.setAttribute('pointer-events','none');svg.append(line);
        }
      }
      readout.textContent=hit?`${curves[hit.i].label||curves[hit.i].expression}：x ≈ ${Number(x.toPrecision(5))}，y ≈ ${Number(hit.y.toPrecision(5))}`:'当前位置没有可读曲线';
    };
    host.onpointerup=event=>{current.gesture?.pointers.delete(event.pointerId);if(host.hasPointerCapture(event.pointerId))host.releasePointerCapture(event.pointerId);};host.onpointercancel=host.onpointerup;
    svg.onkeydown=event=>{if(!['+','=','-','0'].includes(event.key))return;event.preventDefault();event.stopPropagation();
      current.ranges=event.key==='0'?structuredClone(recommended):zoomPlotRanges(current.ranges,event.key==='-'?1.25:.8);refresh();};
  }
  current.draw=refresh;
  if(current.dialog)mountDialog(current.dialog);
  refresh();
}
