import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLessonOpeningPolicy, type AuthoringLesson } from '../src/index.js';
const source = {dsl:'octos.lesson',version:'0.1',profile:'authoring',lesson:{mode:'explain',language:'zh-CN',title:'Introduction',goals:['Learn']},steps:[{key:'one',purpose:'Introduce',beats:[{key:'first',say:'Consider this problem.',actions:[{do:'write',as:'equation',kind:'math',role:'equation',place:{relation:'new_region'},content:{latex:'x=1'},when:'after_speech'}]}]}],close:{summary:'Done',focus:['equation']}} as AuthoringLesson;
test('opening defaults preserve delayed answers and explicit introductions alone may move',()=>{
  const original=structuredClone(source);
  assert.deepEqual(applyLessonOpeningPolicy(source),source);
  const result=applyLessonOpeningPolicy(source,{kind:'introduction',alias:'equation'});
  assert.equal(result.steps[0]!.beats[0]!.actions[0]!.when,'before_speech');
  assert.deepEqual(applyLessonOpeningPolicy(result,{kind:'introduction',alias:'equation'}),result);
  assert.deepEqual(source,original);
  assert.throws(()=>applyLessonOpeningPolicy(source,{kind:'introduction',alias:'missing'}),/explicitly identify/);
});
test('title fallback does not reveal the answer or advance animation and is idempotent',()=>{
  const input=structuredClone(source);
  input.steps[0]!.beats[0]!.actions.push({do:'animate',variable:'h',value:4,when:'after_speech'});
  const result=applyLessonOpeningPolicy(input,{kind:'title'});
  assert.equal(result.steps[0]!.beats[0]!.actions.length,3);
  assert.deepEqual(result.steps[0]!.beats[0]!.actions.slice(1),input.steps[0]!.beats[0]!.actions);
  assert.deepEqual(applyLessonOpeningPolicy(result,{kind:'title'}),result);
  const existing=applyLessonOpeningPolicy(source,{kind:'introduction',alias:'equation'});
  assert.deepEqual(applyLessonOpeningPolicy(existing,{kind:'title'}),existing);
});
