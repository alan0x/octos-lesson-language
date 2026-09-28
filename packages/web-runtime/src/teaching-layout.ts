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

interface Item { id: string; section: string; kind: string; visual: boolean; w: number; h: number }
interface Cluster { visualIds: string[]; controls?: AttachmentSpec; tasks?: AttachmentSpec }
interface Slot { x: number; w: number; y: number }
interface SideColumn { x: number; width: number; frozenWidth: number; ids: string[]; spans: string[] }
interface StageBox { top: number; bottom: number; slots: Record<string, Slot> | null; slotOf: Record<string, Slot> }

const CARD_GAP = 16, WORKBENCH_GAP = 28, SUBCOLUMN_GAP = 20, STEP_GAP = 40, STAGE_GAP = 72, BAND_GAP = 36, CONTROL_GAP = 24;
const MIN_COLUMN_HEIGHT = 260, MIN_WIDE_COLUMN = 300, SAFE_MARGIN = 80, READING_SCALE = 0.9;
const DEFAULT_HEIGHT: Record<string, number> = { math: 90, note: 150, text: 120 };
const DEFAULT_WIDTH: Record<string, number> = { math: 320, note: 330, text: 320 };
const DEFAULT_VISUAL_WIDTH = 460;

/**
 * Stage Rows × Step Columns teaching layout (阶段行 × 步骤列).
 *
 * - A stage is a step that introduces a visual (present or planned) plus the
 *   following steps that add none. Each stage is one row; rows stack downwards.
 * - Inside a row everything reads left to right in narration order: text written
 *   before the stage's first visual, the operation column (controls + practice)
 *   for a single-visual stage, the visual(s), then one column group per step.
 * - Columns fill top-down up to the window's readable height; a new step opens a
 *   new column; a step that would pass the readable width starts the next band.
 * - Planned step contents (plannedSteps) split a step into balanced columns when
 *   it starts, using sizes of cards created earlier; nothing is revisited later.
 * - Optional explicit relations place a card under the visual it explains, or
 *   beside/below the card it explains. Without relations those rules are inert.
 * - Placement is append-only: a card's position depends only on content created
 *   before it, so arriving cards and opening practice never move existing cards.
 */
function computeTeachingRegion(state: SemanticBoardState, ids: string[], sizes: MeasuredNodeSizes,
  region: RegionLayoutConstraint, external: Rect[]) {
  const composition = region.composition!;
  const insets = composition.insets ?? {};
  const safeWidth = composition.width - (insets.left ?? 0) - (insets.right ?? 0) - SAFE_MARGIN;
  const safeHeight = composition.height - (insets.top ?? 0) - (insets.bottom ?? 0) - SAFE_MARGIN;
  const readingWidth = Math.max(320, safeWidth / READING_SCALE);
  const columnHeight = Math.max(MIN_COLUMN_HEIGHT, safeHeight / READING_SCALE);
  const relations = region.relations ?? {};
  const targetsOf = (id: string) => relations[id] ?? [];

  const creationOrder = new Map(Object.keys(region.nodeSections ?? {}).map((id, index) => [id, index]));
  const items: Item[] = [...ids]
    .sort((a, b) => (creationOrder.get(a) ?? 1e9) - (creationOrder.get(b) ?? 1e9))
    .map(id => {
      const kind = String(state.nodes[id]!.kind ?? 'text');
      return { id, section: region.nodeSections?.[id] ?? 'legacy', kind, visual: visualKinds.has(kind),
        w: sizes[id]!.width, h: sizes[id]!.height };
    });
  const byId = new Map(items.map(item => [item.id, item]));
  const planned = region.plannedSteps ?? {};
  const sections = [...new Set(items.map(item => item.section))];
  if (region.plannedSteps) {
    const order = new Map(Object.keys(region.plannedSteps).map((section, index) => [section, index]));
    sections.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  }
  const plannedVisuals = (section: string) => Math.max(planned[section]?.visual ?? 0,
    items.filter(item => item.section === section && item.visual).length);

  // Comparison sets: explicit groups/connections, or a comparison/supporting
  // visual placed right_of another visual of the same step.
  const pairs: string[][] = [];
  const members = (id: string, seen = new Set<string>()): string[] => {
    if (byId.has(id)) return [id];
    if (seen.has(id)) return [];
    seen.add(id);
    return (state.groups[id]?.members ?? []).flatMap((member: string) => members(member, seen));
  };
  for (const group of Object.values(state.groups)) {
    const visuals = members(group.id).filter(id => byId.get(id)?.visual);
    if (visuals.length > 1) pairs.push(visuals);
  }
  const endpoint = (value: any) => typeof value === 'string' ? value : value?.node_id;
  for (const connection of Object.values(state.connections)) {
    const a = byId.get(endpoint(connection.from)), b = byId.get(endpoint(connection.to));
    if (a?.visual && b?.visual) pairs.push([a.id, b.id]);
  }
  for (const item of items) {
    const node = state.nodes[item.id]!;
    const anchor = byId.get(node.placement?.anchor ?? '');
    if (item.visual && node.placement?.relation === 'right_of' && anchor?.visual && anchor.section === item.section
      && ['comparison_visual', 'supporting_visual'].includes(String(node.role ?? ''))) pairs.push([anchor.id, item.id]);
  }
  const paired = (a: string, b: string) => pairs.some(pair => pair.includes(a) && pair.includes(b));

  // Controls and practice, grouped by the visuals they control.
  const clusters: Cluster[] = [];
  for (const attachment of region.attachments ?? []) {
    const visualIds = (attachment.anchorNodeIds?.length ? attachment.anchorNodeIds : [attachment.anchorNodeId])
      .filter(id => byId.get(id)?.visual);
    if (!visualIds.length) continue;
    let cluster = clusters.find(c => c.visualIds.some(id => visualIds.includes(id)));
    if (!cluster) { cluster = { visualIds: [] }; clusters.push(cluster); }
    cluster.visualIds = [...new Set([...cluster.visualIds, ...visualIds])];
    if (attachment.kind === 'task') cluster.tasks = attachment;
    else cluster.controls = attachment;
  }

  // A visual the lesson declares as a comparison/supporting view right_of a
  // visual from an earlier step joins that visual's row instead of opening a
  // new stage, so the compared figures stay side by side.
  const anchorVisuals = (id: string): Item[] => {
    const direct = byId.get(id);
    if (direct) return direct.visual ? [direct] : [];
    return members(id).map(member => byId.get(member)!).filter(item => item?.visual);
  };
  const joinsEarlierRow = (item: Item, stageSections: string[]) => {
    const node = state.nodes[item.id]!;
    if (!item.visual || node.placement?.relation !== 'right_of'
      || !['comparison_visual', 'supporting_visual'].includes(String(node.role ?? ''))) return false;
    const anchors = anchorVisuals(node.placement?.anchor ?? '');
    return anchors.length > 0 && anchors.every(anchor => anchor.section !== item.section && stageSections.includes(anchor.section));
  };
  const joiners = new Set<string>();
  const stages: Array<{ open: string; sections: string[] }> = [];
  for (const section of sections) {
    const current = stages[stages.length - 1];
    const sectionVisuals = items.filter(item => item.section === section && item.visual);
    const joining = current !== undefined && sectionVisuals.length > 0
      && sectionVisuals.every(item => joinsEarlierRow(item, current.sections));
    if (joining) sectionVisuals.forEach(item => joiners.add(item.id));
    if (!stages.length || (plannedVisuals(section) > 0 && !joining)) stages.push({ open: section, sections: [section] });
    else current!.sections.push(section);
  }
  const widestVisual = Math.max(0, ...items.filter(item => item.visual).map(item => item.w));
  const wide = readingWidth >= Math.max(DEFAULT_VISUAL_WIDTH, widestVisual) + WORKBENCH_GAP + MIN_WIDE_COLUMN;

  const nodes: Record<string, Rect> = {}, attachments: Record<string, Rect> = {};
  const slotted = new Set<string>();
  const place = (id: string, x: number, y: number, width: number, height: number) => { nodes[id] = { x, y, width, height }; };
  const placeAttachment = (spec: AttachmentSpec, x: number, y: number) => {
    attachments[spec.id] = { x, y, width: spec.width, height: spec.height };
  };
  const allBottom = () => Math.max(0, ...[...Object.values(nodes), ...Object.values(attachments)].map(r => r.y + r.height));
  // Size estimates come only from cards created before a step starts, so a
  // step's plan never changes while its own cards arrive.
  const estimate = (kind: string, dimension: 'w' | 'h', before: number) => {
    const seen = items.slice(0, before).filter(item => !item.visual && item.kind === kind);
    if (seen.length) return seen.reduce((sum, item) => sum + item[dimension], 0) / seen.length;
    return (dimension === 'h' ? DEFAULT_HEIGHT : DEFAULT_WIDTH)[kind] ?? (dimension === 'h' ? 120 : 320);
  };

  const placeInSlot = (slot: Slot, item: Item, box: StageBox) => {
    if (item.w > slot.w + 1 || slot.y + item.h > box.top + columnHeight) return false;
    place(item.id, slot.x, slot.y, slot.w, item.h);
    slot.y += item.h + CARD_GAP;
    box.bottom = Math.max(box.bottom, slot.y - CARD_GAP);
    box.slotOf[item.id] = slot;
    slotted.add(item.id);
    return true;
  };

  const wideStage = (stage: { open: string; sections: string[] }, top: number, previous: StageBox | null): StageBox => {
    const own = items.filter(item => stage.sections.includes(item.section) && !slotted.has(item.id));
    const opening = own.filter(item => item.section === stage.open);
    const firstVisual = opening.findIndex(item => item.visual);
    let leadIn = firstVisual === -1
      ? (plannedVisuals(stage.open) > 0 ? opening : [])
      : opening.slice(0, firstVisual).filter(item => !item.visual);
    // A lead-in card that explains one visual of the previous row's comparison
    // set is written under that visual instead.
    if (previous?.slots) {
      for (const item of leadIn) {
        const targets = targetsOf(item.id);
        if (targets.length === 1 && previous.slots[targets[0]!]) placeInSlot(previous.slots[targets[0]!]!, item, previous);
      }
      leadIn = leadIn.filter(item => !slotted.has(item.id));
      top = Math.max(top, previous.bottom + STAGE_GAP);
    }
    const visuals = opening.filter(item => item.visual);
    const box: StageBox = { top, bottom: top, slots: null, slotOf: {} };

    let x = 0, colTop = top, colWidth = 0, colY = top, colCount = 0;
    let colIds: string[] = [];
    let side: SideColumn | null = null;
    let plan: { counts: number[]; index: number; placed: number[] } | null = null;
    const columns: Array<{ x: number; width: number; ids: string[]; side: SideColumn | null }> = [];
    const columnRight = () => Math.max(x + colWidth, side ? side.x + side.width : 0);
    const closeColumn = () => {
      if (colCount) columns.push({ x, width: side ? side.frozenWidth : colWidth, ids: [...colIds], side: side && { ...side } });
    };
    const openColumn = (gap: number) => {
      if (colCount) { const right = columnRight(); closeColumn(); x = right + gap; }
      colWidth = 0; colY = colTop; colCount = 0; colIds = []; side = null;
    };
    const wrapToBand = () => {
      closeColumn();
      box.slots = null; // the band occupies the space under the workbench
      colTop = Math.max(box.bottom, allBottom()) + BAND_GAP;
      x = 0; colWidth = 0; colY = colTop; colCount = 0; colIds = []; side = null;
    };
    const addPrimary = (item: Item) => {
      const overflow = colCount > 0 && colY + CARD_GAP + item.h > colTop + columnHeight;
      const planBreak = plan !== null && colCount > 0 && plan.placed[plan.index]! >= plan.counts[plan.index]!
        && plan.index < plan.counts.length - 1;
      // After an explained pair, a wider card spans below the pair when it fits
      // the pair's total width; only a card wider than that opens a new column.
      const tooWide = side !== null && item.w > side.x + side.width - x;
      if (overflow || planBreak || tooWide) {
        openColumn(SUBCOLUMN_GAP);
        if (plan && (planBreak || overflow)) plan.index = Math.min(plan.index + 1, plan.counts.length - 1);
      }
      if (!colCount && x > 0 && x + item.w > readingWidth) wrapToBand();
      const y = colCount ? colY + CARD_GAP : colY;
      place(item.id, x, y, item.w, item.h);
      colIds.push(item.id);
      if (side && item.w > side.frozenWidth) side.spans.push(item.id);
      colY = y + item.h; colCount += 1;
      if (!side) colWidth = Math.max(colWidth, item.w);
      if (plan) plan.placed[plan.index]! += 1;
      box.bottom = Math.max(box.bottom, colY);
    };
    // A card that explains the card just placed in this column sits to its right.
    const tryBeside = (item: Item) => {
      const targets = targetsOf(item.id);
      if (targets.length !== 1 || !colCount || colIds[colIds.length - 1] !== targets[0]) return false;
      if (side?.spans.includes(targets[0]!)) return false;
      const target = nodes[targets[0]!]!;
      const next = side ?? { x: x + colWidth + CARD_GAP, width: 0, frozenWidth: colWidth, ids: [], spans: [] };
      if (next.x + item.w > readingWidth + 1) return false;
      side = next;
      place(item.id, side.x, target.y, item.w, item.h);
      side.ids.push(item.id); side.width = Math.max(side.width, item.w);
      colY = Math.max(colY, target.y + item.h);
      box.bottom = Math.max(box.bottom, colY);
      return true;
    };

    // 1. Lead-in text, left of the stage's first visual.
    if (leadIn.length) { for (const item of leadIn) addPrimary(item); openColumn(WORKBENCH_GAP); }

    // 2. Workbench: operation column (single-visual stages), visuals, controls.
    let referenceHeight = columnHeight;
    let referenceBottom = top;
    if (visuals.length || plannedVisuals(stage.open) > 0) {
      const planCount = plannedVisuals(stage.open);
      const cluster = clusters.find(c => c.controls && c.visualIds.some(id => visuals.some(v => v.id === id)));
      const besideShape = planCount <= 1;
      // Practice takes space only once it is open; no space is reserved for it,
      // so opening practice may move later content once.
      const openTask = cluster?.tasks;
      let x0 = x;
      if (cluster?.controls && besideShape) {
        const operationWidth = Math.max(cluster.controls.width, openTask?.width ?? 0);
        placeAttachment(cluster.controls, x0, top);
        let operationBottom = top + cluster.controls.height;
        referenceBottom = Math.max(referenceBottom, operationBottom);
        if (openTask) {
          placeAttachment(openTask, x0, operationBottom + CARD_GAP);
          operationBottom += CARD_GAP + openTask.height;
        }
        box.bottom = Math.max(box.bottom, operationBottom);
        x0 += operationWidth + WORKBENCH_GAP;
      }
      // Visuals: comparison sets share a top line; planned visuals that have
      // not arrived yet keep their slot so later text never has to move.
      let vx = x0, vy = top, lineHeight = 0, right = x0;
      visuals.forEach((visual, index) => {
        const prior = visuals[index - 1];
        // A comparison set stays on one line whenever it fits the reading width
        // by itself; a lead-in column may push the row past that width instead.
        const together = prior && (paired(prior.id, visual.id) || planCount > 1) && vx - x0 + visual.w <= readingWidth;
        if (index > 0 && !together) { vy += lineHeight + CARD_GAP; vx = x0; lineHeight = 0; }
        place(visual.id, vx, vy, visual.w, visual.h);
        right = Math.max(right, vx + visual.w); vx += visual.w + CARD_GAP; lineHeight = Math.max(lineHeight, visual.h);
      });
      const missing = Math.max(0, planCount - visuals.length);
      if (missing) {
        const width = visuals.at(-1)?.w ?? DEFAULT_VISUAL_WIDTH;
        right = Math.max(right, x0 + (visuals.length + missing) * (width + CARD_GAP) - CARD_GAP);
      }
      let visualBottom = visuals.length ? vy + lineHeight : top + 360;
      referenceBottom = Math.max(referenceBottom, visualBottom);
      box.bottom = Math.max(box.bottom, visualBottom);
      if (cluster?.controls && !besideShape) {
        const bound = cluster.visualIds.map(id => nodes[id]).filter((r): r is Rect => Boolean(r));
        const left = bound.length ? Math.min(...bound.map(r => r.x)) : x0;
        const spanRight = bound.length ? Math.max(...bound.map(r => r.x + r.width)) : right;
        const y = Math.max(visualBottom, ...bound.map(r => r.y + r.height)) + CONTROL_GAP;
        const besideControls = openTask && spanRight - left >= cluster.controls.width + CARD_GAP + openTask.width;
        // Controls keep the left edge of their visuals whether or not practice is open.
        const cx = left;
        placeAttachment(cluster.controls, cx, y);
        let bottom = y + cluster.controls.height;
        referenceBottom = Math.max(referenceBottom, bottom);
        if (openTask) {
          const tx = besideControls ? cx + cluster.controls.width + CARD_GAP : cx;
          const ty = besideControls ? y : y + cluster.controls.height + CARD_GAP;
          placeAttachment(openTask, tx, ty);
          bottom = Math.max(bottom, ty + openTask.height);
        }
        visualBottom = Math.max(visualBottom, bottom);
        box.bottom = Math.max(box.bottom, bottom);
      }
      // Task-only clusters (no controls) sit directly under their visuals.
      for (const c of clusters) {
        if (c.controls || !c.tasks || attachments[c.tasks.id]) continue;
        const bound = c.visualIds.map(id => nodes[id]).filter((r): r is Rect => Boolean(r));
        if (!bound.length) continue;
        const y = Math.max(...bound.map(r => r.y + r.height)) + CONTROL_GAP;
        placeAttachment(c.tasks, Math.min(...bound.map(r => r.x)), y);
        visualBottom = Math.max(visualBottom, y + c.tasks.height);
        box.bottom = Math.max(box.bottom, visualBottom);
      }
      // The row height that guides column splitting ignores open practice, so
      // opening practice shifts later content but never re-splits a step.
      referenceHeight = referenceBottom - top;
      if (Object.keys(relations).length && visuals.length) {
        box.slots = {};
        for (const visual of visuals.filter(v => nodes[v.id]!.y === top)) {
          const r = nodes[visual.id]!;
          box.slots[visual.id] = { x: r.x, w: r.width, y: (besideShape ? r.y + r.height : visualBottom) + CARD_GAP };
        }
      }
      x = right + WORKBENCH_GAP;
    }
    const target = Math.min(columnHeight, Math.max(MIN_COLUMN_HEIGHT, referenceHeight));

    // 3. Explanation: one column group per step.
    colTop = top; colWidth = 0; colY = top; colCount = 0; colIds = []; side = null;
    let first = true;
    for (const section of stage.sections) {
      // Joining visuals open this step's group on the row's top line.
      const joining = own.filter(item => item.section === section && joiners.has(item.id));
      if (joining.length) {
        if (!first) openColumn(STEP_GAP);
        first = false;
        for (const visual of joining) {
          if (x > 0 && x + visual.w > readingWidth) wrapToBand();
          place(visual.id, x, colTop, visual.w, visual.h);
          x += visual.w + CARD_GAP;
          box.bottom = Math.max(box.bottom, colTop + visual.h);
        }
        x += WORKBENCH_GAP - CARD_GAP;
      }
      const cards = own.filter(item => item.section === section && !item.visual && !leadIn.includes(item) && !slotted.has(item.id));
      const flow: Item[] = [];
      for (const item of cards) {
        const targets = targetsOf(item.id);
        const slot = targets.length === 1 ? box.slots?.[targets[0]!] ?? (box.slots ? box.slotOf[targets[0]!] : undefined) : undefined;
        if (slot && placeInSlot(slot, item, box)) continue;
        flow.push(item);
      }
      if (!flow.length) continue;
      if (!first && !joining.length) openColumn(STEP_GAP);
      first = false;
      plan = null;
      const counts = planned[section];
      if (counts) {
        const before = items.indexOf(flow[0]!);
        const leadCount = section === stage.open ? leadIn.length : 0;
        const kinds = [...Array(counts.math ?? 0).fill('math'), ...Array(counts.text ?? 0).fill('note')].slice(leadCount);
        if (kinds.length) {
          const heights = kinds.map(kind => estimate(kind, 'h', before));
          const widths = kinds.map(kind => estimate(kind, 'w', before));
          const total = heights.reduce((sum, h) => sum + h, 0) + CARD_GAP * (heights.length - 1);
          const k = Math.min(heights.length, Math.max(1, Math.ceil(total / target)));
          const split = balancedCounts(heights, k);
          let offset = 0;
          const estimatedWidth = split.reduce((sum, n) => {
            const width = Math.max(...widths.slice(offset, offset + n)); offset += n; return sum + width;
          }, 0) + SUBCOLUMN_GAP * (split.length - 1);
          if (x > 0 && x + estimatedWidth > readingWidth) wrapToBand();
          plan = { counts: split, index: 0, placed: split.map(() => 0) };
        }
      }
      if (!plan && x > 0 && x + flow[0]!.w > readingWidth) wrapToBand();
      for (const item of flow) if (!tryBeside(item)) addPrimary(item);
    }
    closeColumn();
    // Neat columns: text cards take their column's width; visuals keep theirs.
    for (const column of columns) {
      const spanTo = column.side ? column.side.x + column.side.width - column.x : column.width;
      for (const id of column.ids) nodes[id]!.width = column.side?.spans.includes(id) ? spanTo : column.width;
      if (column.side) for (const id of column.side.ids) nodes[id]!.width = column.side.width;
    }
    box.bottom = Math.max(box.bottom, allBottom());
    return box;
  };

  // Narrow windows: one readable stream. Comparison visuals stay side by side
  // only when they fit; controls follow the first visual they control; text
  // cards take the stream width. Opening practice pushes the rest down once.
  const narrowStage = (stage: { open: string; sections: string[] }, top: number): StageBox => {
    const own = items.filter(item => stage.sections.includes(item.section));
    const width = Math.min(readingWidth, Math.max(0, ...own.map(item => item.w)));
    let y = top;
    const opening = own.filter(item => item.section === stage.open);
    const firstVisual = opening.findIndex(item => item.visual);
    const leadIn = firstVisual > 0 ? opening.slice(0, firstVisual) : [];
    for (const item of leadIn) { place(item.id, 0, y, width, item.h); y += item.h + CARD_GAP; }
    const visuals = opening.filter(item => item.visual);
    const done = new Set<Cluster>();
    for (let i = 0; i < visuals.length; i++) {
      const visual = visuals[i]!, next = visuals[i + 1];
      const row = next && paired(visual.id, next.id) && visual.w + CARD_GAP + next.w <= readingWidth ? [visual, next] : [visual];
      let x = 0, height = 0;
      for (const item of row) { place(item.id, x, y, item.w, item.h); x += item.w + CARD_GAP; height = Math.max(height, item.h); }
      y += height;
      if (row.length > 1) i += 1;
      for (const cluster of clusters) {
        if (done.has(cluster) || !row.some(item => cluster.visualIds.includes(item.id))) continue;
        done.add(cluster);
        if (cluster.controls) { y += CONTROL_GAP; placeAttachment(cluster.controls, 0, y); y += cluster.controls.height; }
        if (cluster.tasks) { y += CARD_GAP; placeAttachment(cluster.tasks, 0, y); y += cluster.tasks.height; }
      }
      y += CARD_GAP;
    }
    if (visuals.length) y += STEP_GAP - CARD_GAP;
    let first = true;
    for (const section of stage.sections) {
      const joining = own.filter(item => item.section === section && joiners.has(item.id));
      const cards = own.filter(item => item.section === section && !item.visual && !leadIn.includes(item));
      if (!cards.length && !joining.length) continue;
      if (!first) y += STEP_GAP - CARD_GAP;
      first = false;
      for (const visual of joining) { place(visual.id, 0, y, visual.w, visual.h); y += visual.h + CARD_GAP; }
      for (const item of cards) { place(item.id, 0, y, width, item.h); y += item.h + CARD_GAP; }
    }
    return { top, bottom: Math.max(top, y - CARD_GAP), slots: null, slotOf: {} };
  };

  let previous: StageBox | null = null;
  for (const stage of stages) {
    const top = previous ? previous.bottom + STAGE_GAP : 0;
    const box: StageBox = wide ? wideStage(stage, top, previous) : narrowStage(stage, top);
    previous = box;
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

/** Split ordered heights into k contiguous groups minimising the tallest group. */
function balancedCounts(heights: number[], k: number): number[] {
  const n = heights.length;
  if (k <= 1 || n <= 1) return [n];
  const prefix = [0];
  for (const h of heights) prefix.push(prefix[prefix.length - 1]! + h);
  const cost = (i: number, j: number) => prefix[j]! - prefix[i]! + CARD_GAP * (j - i - 1);
  const best = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(0));
  best[0]![0] = 0;
  for (let g = 1; g <= k; g++) for (let j = 1; j <= n; j++) for (let i = g - 1; i < j; i++) {
    const value = Math.max(best[g - 1]![i]!, cost(i, j));
    if (value < best[g]![j]!) { best[g]![j] = value; cut[g]![j] = i; }
  }
  const counts: number[] = [];
  let j = n;
  for (let g = k; g >= 1; g--) { const i = cut[g]![j]!; counts.unshift(j - i); j = i; }
  return counts.filter(count => count > 0);
}

const compositionCache = new Map<string, ReturnType<typeof computeTeachingRegion>>();
export function layoutTeachingRegion(state: SemanticBoardState, ids: string[], sizes: MeasuredNodeSizes,
  region: RegionLayoutConstraint, external: Rect[]) {
  if (!region.composition) return layoutLegacyTeachingRegion(state,ids,sizes,region,external);
  const key=JSON.stringify([ids.map(id=>[id,state.nodes[id]!.kind,state.nodes[id]!.role,state.nodes[id]!.placement]),state.groups,state.connections,sizes,region,external]);
  const cached=compositionCache.get(key);
  if(cached)return structuredClone(cached);
  const result=computeTeachingRegion(state,ids,sizes,region,external);
  if(compositionCache.size>=24)compositionCache.delete(compositionCache.keys().next().value!);
  compositionCache.set(key,structuredClone(result));
  return result;
}
