import { planFocusCamera } from './camera.js';
import type { SemanticBoardState } from '../../core/src/index.js';
import type { Rect, MeasuredNodeSizes, RegionLayoutConstraint } from './layout.js';

const visualKinds = new Set(['geometry', 'scene3d', 'plot', 'image', 'diagram']);
const gap = 28;
const bounds = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x+r.width))-x, height: Math.max(...rects.map(r => r.y+r.height))-y };
};
const overlaps = (a: Rect,b: Rect) => a.x < b.x+b.width+12 && a.x+a.width+12>b.x && a.y<b.y+b.height+12 && a.y+a.height+12>b.y;

/** Presentation-only layout. Section ownership comes from creation events, never prose or ID parsing. */
function layoutLegacyTeachingRegion(state: SemanticBoardState, ids: string[], sizes: MeasuredNodeSizes,
  region: RegionLayoutConstraint, external: Rect[]) {
  const nodes: Record<string, Rect> = {}, attachments: Record<string, Rect> = {};
  const width = Math.max(280, region.reservedWidth ?? 1300);
  const idSet = new Set(ids);
  const parent = new Map(ids.map(id => [id,id]));
  const root = (id: string): string => { const p=parent.get(id)!; return p===id?id:root(p); };
  const join = (a:string,b:string) => { if(idSet.has(a)&&idSet.has(b))parent.set(root(b),root(a)); };
  // Only explicit visual relationships create comparison units. Ordinary 'below'
  // chains are creation order, not evidence that an entire course is one unit.
  for(const id of ids) {
    const node=state.nodes[id]!, anchor=node.placement?.anchor;
    if(anchor && visualKinds.has(node.kind) && visualKinds.has(state.nodes[anchor]?.kind)) join(anchor,id);
  }
  const members = (id:string,seen=new Set<string>()):string[] => {
    if(idSet.has(id))return [id];
    if(seen.has(id))return []; seen.add(id);
    return (state.groups[id]?.members??[]).flatMap((m:string)=>members(m,seen));
  };
  for(const group of Object.values(state.groups)) {const list=members(group.id); for(const id of list.slice(1))join(list[0]!,id);}
  for(const connection of Object.values(state.connections)) {
    const endpoint=(v:any)=>typeof v==='string'?v:v?.node_id;
    const a=endpoint(connection.from),b=endpoint(connection.to);
    if(visualKinds.has(state.nodes[a]?.kind)&&visualKinds.has(state.nodes[b]?.kind))join(a,b);
  }
  // Shared controls are displayed once below all of their actual visual owners.
  for(const attachment of region.attachments??[]) {
    if(attachment.kind==='task')continue;
    const list=(attachment.anchorNodeIds??[attachment.anchorNodeId]).filter(id=>idSet.has(id));
    for(const id of list.slice(1))join(list[0]!,id);
  }
  const units: string[][]=[];const byRoot=new Map<string,string[]>();
  for(const id of ids){const r=root(id);let unit=byRoot.get(r);if(!unit){unit=[];byRoot.set(r,unit);units.push(unit);}unit.push(id);}
  const sections=region.nodeSections??{};
  const sectionOrder=[...new Set(ids.map(id=>sections[id]??'legacy'))];
  units.sort((a,b)=>sectionOrder.indexOf(sections[a[0]!]??'legacy')-sectionOrder.indexOf(sections[b[0]!]??'legacy') || ids.indexOf(a[0]!)-ids.indexOf(b[0]!));
  let bottom=region.y, rowX=0,rowY=0,rowHeight=0,section='';
  const placed:Rect[]=[...external,...region.obstacles??[]];
  const finishRow=()=>{if(rowHeight){bottom=Math.max(bottom,rowY+rowHeight+gap);rowHeight=0;rowX=0;}};
  const avoid=(rect:Rect):Rect=>{
    let result={...rect};
    // Each move clears at least one obstacle's bottom; no arbitrary retry cap.
    for(let i=0;i<=placed.length;i++) {const hits=placed.filter(r=>overlaps(result,r));if(!hits.length)return result;result.y=Math.max(...hits.map(r=>r.y+r.height))+gap;}
    return result;
  };
  const doneAttachments=new Set<string>();
  for(const unit of units){
    const nextSection=sections[unit[0]!]??'legacy';if(nextSection!==section){finishRow();if(section)bottom+=gap;section=nextSection;}
    const visual=unit.some(id=>visualKinds.has(state.nodes[id]!.kind));
    if(visual||unit.length>1)finishRow();
    const local:Record<string,Rect>={};let x=0,y=0,h=0;
    for(const id of unit){const size=sizes[id]!;const w=Math.min(size.width,width);
      if(x&&x+w>width){y+=h+gap;x=0;h=0;}
      local[id]={x,y,width:w,height:size.height};x+=w+gap;h=Math.max(h,size.height);
    }
    let box=bounds(Object.values(local));
    const ownAttachments=(region.attachments??[]).filter(a=>a.kind!=='task'&&!doneAttachments.has(a.id)
      && (a.anchorNodeIds??[a.anchorNodeId]).some(id=>unit.includes(id)));
    const localAttachments:Record<string,Rect>={};
    for(const a of ownAttachments){const w=Math.min(width,a.width);box.width=Math.max(box.width,w);
      localAttachments[a.id]={x:Math.max(0,(box.width-w)/2),y:box.height+(a.gap??24),width:w,height:a.height};
      box.height=localAttachments[a.id]!.y+a.height;doneAttachments.add(a.id);}
    if(!visual&&unit.length===1){
      if(rowX&&rowX+box.width>width)finishRow();
      if(!rowHeight)rowY=bottom;
    }
    const start=avoid({x:region.x+(!visual&&unit.length===1?rowX:0),y:!visual&&unit.length===1?rowY:bottom,width:box.width,height:box.height});
    for(const [id,r] of Object.entries(local))nodes[id]={...r,x:r.x+start.x,y:r.y+start.y};
    for(const [id,r] of Object.entries(localAttachments))attachments[id]={...r,x:r.x+start.x,y:r.y+start.y};
    placed.push(start);
    if(visual||unit.length>1)bottom=start.y+start.height+gap;
    else {rowX+=box.width+gap;rowHeight=Math.max(rowHeight,start.y-rowY+start.height);}
  }
  finishRow();
  // Practice is a separate block, so opening it cannot move the controls or diagrams.
  for(const a of region.attachments??[]){if(doneAttachments.has(a.id)||!ids.some(id=>(a.anchorNodeIds??[a.anchorNodeId]).includes(id)))continue;
    const r=avoid({x:region.x,y:bottom,width:Math.min(width,a.width),height:a.height});attachments[a.id]=r;placed.push(r);bottom=r.y+r.height+gap;
  }
  return {nodes,attachments};
}

type AttachmentSpec = NonNullable<RegionLayoutConstraint['attachments']>[number];

interface StageGroup {
  openingSection: string;
  sections: string[];
  visualIds: string[];
  plannedVisuals: number;
  plannedExplainCount: number;
  plannedExplainSteps: number;
  hasNextStage: boolean;
  stepBlocks: Array<{ section: string; explainIds: string[] }>;
  controls: AttachmentSpec[];
  tasks: AttachmentSpec[];
}

/**
 * Stage-Anchored Step-Stream teaching layout (通用语义锚点 × 步骤连续流布局).
 *
 * 1. Steps are grouped into Visual Stages: a new stage opens at the first step
 *    or whenever a step introduces new visual anchor card(s) (geometry, plot,
 *    scene3d, image, diagram). Subsequent non-visual steps attach to the active
 *    stage's right-hand explanation spine in strict step order.
 * 2. Interactive attachments (variable controls and student practice tasks) bind
 *    to the stage owning their anchored visual(s) and form a cohesive dock
 *    adjacent to the visual and controls (<28px gap), never exiled to a distant
 *    text column.
 * 3. Each stage adapts its internal topology to the available horizontal budget:
 *    - Topology A (Left Visual Workbench + Right Step-Ordered Spine) when the
 *      stage has >= 380px of horizontal room beside the visual block.
 *    - Topology B (Top Visual Banner + Bottom Interactive Dock & Step Spine)
 *      when dual comparison visuals occupy a narrow viewport (< 380px remaining
 *      beside the dual visuals), preserving side-by-side visual comparison
 *      without forcing extreme horizontal zoom-out.
 * 4. Inside each step of the explanation spine, cards flow horizontally in
 *    creation order and wrap cleanly within the spine width; if a later multi-card
 *    summary step exceeds the visual workbench height, it reclaims the full stage
 *    width below the visual workbench.
 */
function computeTeachingRegion(state: SemanticBoardState, ids: string[], sizes: MeasuredNodeSizes,
  region: RegionLayoutConstraint, external: Rect[]) {
  const composition = region.composition;
  if (!composition) return layoutLegacyTeachingRegion(state, ids, sizes, region, external);

  const cardGap = 16, stepGap = 24, colGap = 28, stageGap = 36;
  const vpWidth = composition.width;
  const targetBoardW = vpWidth >= 1600 ? 1600 : vpWidth >= 1100 ? 1320 : 928;
  const sectionOf = (id: string) => region.nodeSections?.[id] ?? 'legacy';
  const isVisual = (kind: string) => visualKinds.has(kind);

  // Pre-compute planned stage summaries from region.plannedSteps so progressive
  // playback knows from Beat 1 whether a stage has 2 visuals or a subsequent stage.
  const plannedStageMap = new Map<string, { visuals: number; explainCount: number; explainSteps: number; hasNextStage: boolean }>();
  if (region.plannedSteps) {
    const pStages: Array<{ opening: string; visuals: number; explainCount: number; explainSteps: number }> = [];
    for (const [sec, counts] of Object.entries(region.plannedSteps)) {
      const v = counts.visual ?? 0;
      const e = (counts.math ?? 0) + (counts.text ?? 0);
      if (v === 0 && e === 0) continue;
      if (pStages.length === 0 || v > 0) {
        pStages.push({ opening: sec, visuals: v, explainCount: e, explainSteps: e > 0 ? 1 : 0 });
      } else {
        const cur = pStages[pStages.length - 1]!;
        cur.explainCount += e;
        if (e > 0) cur.explainSteps += 1;
      }
    }
    pStages.forEach((ps, idx) => {
      plannedStageMap.set(ps.opening, {
        visuals: ps.visuals,
        explainCount: ps.explainCount,
        explainSteps: ps.explainSteps,
        hasNextStage: idx < pStages.length - 1,
      });
    });
  }

  const creationOrder = new Map(Object.keys(region.nodeSections ?? {}).map((id, idx) => [id, idx]));
  const orderedIds = [...ids].sort((a, b) => (creationOrder.get(a) ?? 1e9) - (creationOrder.get(b) ?? 1e9));
  const rowKeys: string[] = [];
  const rows = new Map<string, string[]>();
  for (const id of orderedIds) {
    const section = sectionOf(id);
    if (!rows.has(section)) { rows.set(section, []); rowKeys.push(section); }
    rows.get(section)!.push(id);
  }
  if (region.plannedSteps) {
    const stepOrder = new Map(Object.keys(region.plannedSteps).map((sec, idx) => [sec, idx]));
    rowKeys.sort((a, b) => (stepOrder.get(a) ?? 1e9) - (stepOrder.get(b) ?? 1e9));
  }

  const stages: StageGroup[] = [];
  for (const section of rowKeys) {
    const rowIds = rows.get(section)!;
    const visIds = rowIds.filter(id => isVisual(String(state.nodes[id]!.kind ?? '')));
    const explainIds = rowIds.filter(id => !isVisual(String(state.nodes[id]!.kind ?? '')));
    const stepPlan = region.plannedSteps?.[section];
    const hasVisual = visIds.length > 0 || (stepPlan?.visual ?? 0) > 0;
    if (stages.length === 0 || hasVisual) {
      const ps = plannedStageMap.get(section);
      stages.push({
        openingSection: section,
        sections: [section],
        visualIds: [...visIds],
        plannedVisuals: Math.max(visIds.length, stepPlan?.visual ?? 0, ps?.visuals ?? 0),
        plannedExplainCount: Math.max(explainIds.length, ps?.explainCount ?? 0),
        plannedExplainSteps: Math.max(explainIds.length ? 1 : 0, ps?.explainSteps ?? 0),
        hasNextStage: ps?.hasNextStage ?? false,
        stepBlocks: explainIds.length ? [{ section, explainIds }] : [],
        controls: [],
        tasks: [],
      });
    } else {
      const cur = stages[stages.length - 1]!;
      cur.sections.push(section);
      if (explainIds.length) {
        cur.stepBlocks.push({ section, explainIds });
        cur.plannedExplainCount = Math.max(cur.plannedExplainCount,
          cur.stepBlocks.reduce((acc, b) => acc + b.explainIds.length, 0));
        cur.plannedExplainSteps = Math.max(cur.plannedExplainSteps, cur.stepBlocks.length);
      }
    }
  }
  stages.forEach((sg, idx) => {
    if (idx < stages.length - 1) sg.hasNextStage = true;
  });

  // Bind controls and practice tasks to the stage owning their anchored visual(s).
  for (const a of region.attachments ?? []) {
    const anchors = (a.anchorNodeIds?.length ? a.anchorNodeIds : [a.anchorNodeId]).filter(id => ids.includes(id));
    if (!anchors.length || !stages.length) continue;
    const targetStage = stages.find(sg => sg.visualIds.includes(a.anchorNodeId))
      ?? stages.find(sg => anchors.some(id => sg.visualIds.includes(id)))
      ?? stages.find(sg => anchors.some(id => sg.sections.includes(sectionOf(id))))
      ?? stages[stages.length - 1]!;
    if (a.kind === 'task') targetStage.tasks.push(a);
    else targetStage.controls.push(a);
  }

  const nodes: Record<string, Rect> = {}, attachments: Record<string, Rect> = {};
  let stageY = 0;

  const layoutFlowBlock = (cardIds: string[], startX: number, startY: number, maxW: number): number => {
    let cx = 0, cy = 0, lineH = 0;
    for (const id of cardIds) {
      const size = sizes[id]!;
      const w = Math.min(maxW, size.width);
      if (cx > 0 && cx + w > maxW) {
        cy += lineH + cardGap;
        cx = 0;
        lineH = 0;
      }
      nodes[id] = { x: startX + cx, y: startY + cy, width: w, height: size.height };
      cx += w + cardGap;
      lineH = Math.max(lineH, size.height);
    }
    return cy + lineH;
  };

  const estimateFlowBlockHeight = (cardIds: string[], maxW: number): { height: number; maxCardW: number } => {
    let cx = 0, cy = 0, lineH = 0, maxCardW = 0;
    for (const id of cardIds) {
      const size = sizes[id]!;
      maxCardW = Math.max(maxCardW, size.width);
      const w = Math.min(maxW, size.width);
      if (cx > 0 && cx + w > maxW) {
        cy += lineH + cardGap;
        cx = 0;
        lineH = 0;
      }
      cx += w + cardGap;
      lineH = Math.max(lineH, size.height);
    }
    return { height: cy + lineH, maxCardW };
  };

  for (const sg of stages) {
    // 1. Place visual anchor cards (up to 2 side-by-side per row)
    const perRow = 2;
    let vx = 0, vy = 0, vRowH = 0, vUsed = 0, maxVisRight = 0;
    for (const vid of sg.visualIds) {
      const size = sizes[vid]!;
      if (vUsed === perRow) {
        vy += vRowH + cardGap;
        vx = 0;
        vRowH = 0;
        vUsed = 0;
      }
      nodes[vid] = { x: vx, y: stageY + vy, width: size.width, height: size.height };
      vx += size.width + cardGap;
      vRowH = Math.max(vRowH, size.height);
      vUsed += 1;
      maxVisRight = Math.max(maxVisRight, nodes[vid]!.x + nodes[vid]!.width);
    }
    const visH = sg.visualIds.length ? vy + vRowH : 0;
    const firstVisW = sg.visualIds.length ? sizes[sg.visualIds[0]!]!.width : 460;
    const reservedVisW = sg.visualIds.length >= 2
      ? maxVisRight
      : sg.plannedVisuals >= 2
        ? Math.max(maxVisRight, firstVisW * 2 + cardGap)
        : sg.plannedVisuals === 1
          ? Math.max(maxVisRight, firstVisW)
          : maxVisRight;

    const remRightW = targetBoardW - (reservedVisW + colGap);

    // 2. Topology B (Top-Banner Dual Visuals + Bottom Dock & Spine on Narrow Viewport)
    if (reservedVisW > 0 && remRightW < 380) {
      const ctrlGap = sg.controls[0]?.gap ?? 24;
      const belowY = stageY + visH + ctrlGap;
      let dockBottom = stageY + visH;
      let dockMaxW = 0;

      if (sg.stepBlocks.length === 0 && sg.plannedExplainCount === 0) {
        // Pure visual + interactive stage: place controls on left, tasks side-by-side on right
        let cy = belowY;
        for (const ctrl of sg.controls) {
          attachments[ctrl.id] = { x: 0, y: cy, width: ctrl.width, height: ctrl.height };
          cy += ctrl.height + (ctrl.gap ?? cardGap);
          dockMaxW = Math.max(dockMaxW, ctrl.width);
          dockBottom = Math.max(dockBottom, attachments[ctrl.id]!.y + ctrl.height);
        }
        const taskX = dockMaxW > 0 ? dockMaxW + cardGap : 0;
        let ty = belowY;
        for (const task of sg.tasks) {
          const tw = Math.min(360, task.width);
          attachments[task.id] = { x: taskX, y: ty, width: tw, height: task.height };
          ty += task.height + cardGap;
          dockBottom = Math.max(dockBottom, attachments[task.id]!.y + task.height);
        }
        stageY = dockBottom + stageGap;
        continue;
      }

      let dy = belowY;
      for (const ctrl of sg.controls) {
        attachments[ctrl.id] = { x: 0, y: dy, width: ctrl.width, height: ctrl.height };
        dy += ctrl.height + cardGap;
        dockMaxW = Math.max(dockMaxW, ctrl.width);
        dockBottom = Math.max(dockBottom, attachments[ctrl.id]!.y + ctrl.height);
      }
      for (const task of sg.tasks) {
        const tw = Math.min(360, task.width);
        attachments[task.id] = { x: 0, y: dy, width: tw, height: task.height };
        dy += task.height + cardGap;
        dockMaxW = Math.max(dockMaxW, tw);
        dockBottom = Math.max(dockBottom, attachments[task.id]!.y + task.height);
      }

      const hasDock = sg.controls.length > 0 || sg.tasks.length > 0;
      const spineX = hasDock ? dockMaxW + colGap : 0;
      const maxSpineW = Math.max(440, Math.max(targetBoardW, reservedVisW) - spineX);
      let spineY = stageY + visH + 20;
      let spineBottom = stageY + visH;
      for (const sb of sg.stepBlocks) {
        const bh = layoutFlowBlock(sb.explainIds, spineX, spineY, maxSpineW);
        spineBottom = spineY + bh;
        spineY = spineBottom + stepGap;
      }
      stageY = Math.max(stageY + visH, dockBottom, spineBottom) + stageGap;
      continue;
    }

    // 3. Topology A (Left Visual Workbench + Right Step-Ordered Explanation Spine)
    const sideBySideDock = reservedVisW >= 706;
    const pocketInRightSpine = !sideBySideDock
      && reservedVisW > 0
      && sg.hasNextStage
      && sg.plannedExplainSteps <= 1
      && sg.stepBlocks.length <= 1
      && sg.controls.length > 0;

    const ctrlGap = sg.controls[0]?.gap ?? 24;
    let ctrlY = stageY + visH + ctrlGap;
    let ctrlBottom = stageY + visH;
    let ctrlMaxW = 0;
    for (const ctrl of sg.controls) {
      const cw = Math.min(reservedVisW || ctrl.width, ctrl.width);
      const cx = pocketInRightSpine ? Math.max(0, reservedVisW - cw) : 0;
      attachments[ctrl.id] = { x: cx, y: ctrlY, width: cw, height: ctrl.height };
      ctrlBottom = ctrlY + ctrl.height;
      ctrlY = ctrlBottom + (ctrl.gap ?? cardGap);
      ctrlMaxW = Math.max(ctrlMaxW, cx + cw);
    }

    const spineX = reservedVisW > 0 ? reservedVisW + colGap : 0;
    const firstBlockMaxW = sg.stepBlocks.length > 0
      ? Math.max(0, ...sg.stepBlocks[0]!.explainIds.map(id => sizes[id]!.width))
      : 0;
    const maxSpineW = reservedVisW > 0
      ? Math.max(440, targetBoardW - spineX, firstBlockMaxW)
      : targetBoardW;

    const leftRefH = Math.max(visH, sg.controls.length ? ctrlBottom - stageY : 0);
    let spineY = stageY;
    let spineBottom = stageY;
    const trailingBlocks: Array<{ section: string; explainIds: string[] }> = [];

    for (let bi = 0; bi < sg.stepBlocks.length; bi++) {
      const sb = sg.stepBlocks[bi]!;
      const { height: estH, maxCardW } = estimateFlowBlockHeight(sb.explainIds, maxSpineW);
      const spineH = spineBottom - stageY;
      if (
        reservedVisW > 0
        && bi > 0
        && (maxCardW > maxSpineW || (spineH >= leftRefH * 0.75 && spineH + estH > leftRefH + 80 && sb.explainIds.length >= 3))
      ) {
        trailingBlocks.push(...sg.stepBlocks.slice(bi));
        break;
      }
      const bh = layoutFlowBlock(sb.explainIds, spineX, spineY, maxSpineW);
      spineBottom = spineY + bh;
      spineY = spineBottom + stepGap;
    }

    // Place practice tasks in the Stage's interactive dock:
    // - Dual-visual workbench (reservedVisW >= 706): side-by-side to the right of controls
    // - Multi-stage single-step opening stage (e.g. partial derivative Stage 1): pocket in right spine below Step 1
    // - Standard single-visual workbench: directly below controls (16px gap)
    let taskBottom = ctrlBottom;
    if (sg.tasks.length > 0) {
      if (sideBySideDock) {
        const tx = sg.controls.length > 0 ? ctrlMaxW + cardGap : 0;
        let ty = stageY + visH + ctrlGap;
        for (const task of sg.tasks) {
          const tw = Math.min(360, task.width);
          attachments[task.id] = { x: tx, y: ty, width: tw, height: task.height };
          taskBottom = Math.max(taskBottom, ty + task.height);
          ty += task.height + cardGap;
        }
      } else if (pocketInRightSpine) {
        let ty = Math.max(stageY, spineBottom + cardGap, ctrlBottom - sg.tasks[0]!.height);
        for (const task of sg.tasks) {
          const tw = Math.min(maxSpineW, task.width);
          attachments[task.id] = { x: spineX, y: ty, width: tw, height: task.height };
          taskBottom = Math.max(taskBottom, ty + task.height);
          ty += task.height + cardGap;
        }
      } else {
        let ty = sg.controls.length > 0 ? ctrlBottom + cardGap : stageY + visH + ctrlGap;
        for (const task of sg.tasks) {
          const tw = Math.min(reservedVisW || task.width, task.width);
          attachments[task.id] = { x: 0, y: ty, width: tw, height: task.height };
          taskBottom = Math.max(taskBottom, ty + task.height);
          ty += task.height + cardGap;
        }
      }
    }

    let stageBottom = Math.max(stageY + visH, ctrlBottom, taskBottom, spineBottom);
    if (trailingBlocks.length > 0) {
      const fullStageW = Math.max(targetBoardW, spineX + maxSpineW);
      let trailY = stageBottom + stepGap;
      for (const tb of trailingBlocks) {
        const bh = layoutFlowBlock(tb.explainIds, 0, trailY, fullStageW);
        stageBottom = trailY + bh;
        trailY = stageBottom + stepGap;
      }
    }

    stageY = stageBottom + stageGap;
  }

  const placed = [...Object.values(nodes), ...Object.values(attachments)];
  if (!placed.length) return { nodes: {}, attachments: {} };
  // Translate the complete composition around free-board ink and other regions.
  // Internal relationships stay intact; coordinates never depend on camera zoom.
  let box = { ...bounds(placed), x: region.x, y: region.y };
  const obstacles = [...external, ...region.obstacles ?? []];
  for (let i = 0; i <= obstacles.length; i++) {
    const hits = obstacles.filter(r => overlaps(box, r));
    if (!hits.length) break;
    box.y = Math.max(...hits.map(r => r.y + r.height)) + gap;
  }
  for (const rect of placed) { rect.x += box.x; rect.y += box.y; }
  const result = { nodes, attachments };
  const pinnedNodes = Object.fromEntries(Object.entries(region.pinned?.nodes ?? {}).filter(([id]) => ids.includes(id)));
  if (Object.keys(pinnedNodes).length) {
    const pinnedAttachments = Object.fromEntries(Object.entries(region.pinned?.attachments ?? {}).filter(([id]) => result.attachments[id]));
    const fixed = [...Object.values(pinnedNodes), ...Object.values(pinnedAttachments)];
    const added = [...Object.entries(result.nodes).filter(([id]) => !pinnedNodes[id]).map(([, r]) => r),
      ...Object.entries(result.attachments).filter(([id]) => !pinnedAttachments[id]).map(([, r]) => r)];
    if (added.length) {
      const newBox = bounds(added);
      const offset = Math.max(0, Math.max(...fixed.map(r => r.y + r.height)) + gap - newBox.y);
      for (const rect of added) rect.y += offset;
    }
    Object.assign(result.nodes, pinnedNodes);
    Object.assign(result.attachments, pinnedAttachments);
  }
  return result;
}

const compositionCache = new Map<string, ReturnType<typeof computeTeachingRegion>>();
export function layoutTeachingRegion(state: SemanticBoardState, ids: string[], sizes: MeasuredNodeSizes,
  region: RegionLayoutConstraint, external: Rect[]) {
  if (!region.composition) return layoutLegacyTeachingRegion(state,ids,sizes,region,external);
  const key=JSON.stringify([ids.map(id=>[id,state.nodes[id]!.kind,state.nodes[id]!.placement]),state.groups,state.connections,sizes,region,external]);
  const cached=compositionCache.get(key);
  if(cached)return structuredClone(cached);
  const result=computeTeachingRegion(state,ids,sizes,region,external);
  if(compositionCache.size>=24)compositionCache.delete(compositionCache.keys().next().value!);
  compositionCache.set(key,structuredClone(result));
  return result;
}
