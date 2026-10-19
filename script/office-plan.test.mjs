import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficePlan } from '../src/lib/office-plan.ts';
const task = { id: 't1', agentId: 'worker-id', title: 'Title', instructions: 'Inspect', dependsOn: [] };
const parse = tasks => parseOfficePlan(JSON.stringify({ tasks }), ['worker-id']);
test('validated plan starts queued and retains only allowed fields', () => {
  const plan = parse([{ ...task, status: 'completed', output: 'invented' }, { ...task, id: 't2', dependsOn: ['t1'] }]);
  assert.equal(plan[0].status, 'queued'); assert.equal(plan[0].output, ''); assert.deepEqual(plan[1].dependsOn, ['t1']);
});
test('unknown agent names and roles cannot substitute for worker IDs', () => {
  assert.throws(() => parse([{ ...task, agentId: 'developer' }]), /agentId/);
});
test('future, circular and duplicate task identities are rejected', () => {
  assert.throws(() => parse([{ ...task, dependsOn: ['t2'] }, { ...task, id: 't2' }]));
  assert.throws(() => parse([{ ...task, dependsOn: ['t1'] }]));
  assert.throws(() => parse([task, task]));
});
test('invalid shape, empty instructions and excessive task counts are rejected', () => {
  for (const tasks of [[], [null], [{ ...task, instructions: '' }], [{ ...task, id: '' }], Array.from({length:5}, (_,i)=>({...task,id:String(i)}))]) assert.throws(() => parse(tasks));
  assert.throws(() => parseOfficePlan('not JSON', ['worker-id']));
});
