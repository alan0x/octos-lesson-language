import type { AuthoringLesson } from './types.js';

export type LessonOpeningPolicy = { kind: 'preserve' } | { kind: 'title' } | { kind: 'introduction'; alias: string };

/** The caller declares introduction content; never classify answers from prose. */
export function applyLessonOpeningPolicy(source: AuthoringLesson, policy: LessonOpeningPolicy = {kind:'preserve'}): AuthoringLesson {
  const result=structuredClone(source);
  if(policy.kind==='preserve'||source.board_context?.references.length)return result;
  const first=result.steps[0]?.beats[0];
  if(!first?.say?.trim())return result;
  if(policy.kind==='introduction'){
    const introduction=first.actions.find(a=>a.do==='write'&&a.as===policy.alias);
    if(!introduction || introduction.do!=='write' || !['text','math','note'].includes(introduction.kind))
      throw new Error('Opening introduction must explicitly identify a text, math or note write in the first beat');
    // Bindings and visual actions may depend on state; they are never advanced.
    if(introduction.content.bindings)throw new Error('Opening introduction cannot have value bindings');
    introduction.when='before_speech';
    return result;
  }
  if(first.actions.some(a=>a.do==='write'&&a.when!=='after_speech'))return result;
  const aliases=new Set(result.steps.flatMap(s=>s.beats).flatMap(b=>b.actions).flatMap(a=>'as' in a?[a.as]:[]));
  let alias='opening-title',suffix=1;while(aliases.has(alias))alias=`opening-title-${suffix++}`;
  first.actions.unshift({do:'write',as:alias,kind:'note',role:'explanation',content:{title:source.lesson.title,items:['本课导入']},place:{relation:'new_region'},when:'before_speech'});
  return result;
}
