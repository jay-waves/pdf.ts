import assert from 'node:assert/strict';
import test from 'node:test';
import { createPdfSearchStore } from '../apps/search/pdf-search.ts';
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const tasks = [];
  const store = createPdfSearchStore();
  store.getState().attach({ getDocument: () => ({
    pages: { list: async () => ({pages:[{ref:{objectNumber:3}},{ref:{objectNumber:8}}]}) },
    search: { query(request) {
      let resolve, reject;
      const task = new Promise((ok, no) => {resolve=ok;reject=no;});
      let aborted=false; task.abort=()=>{aborted=true;};
      tasks.push({request, resolve, reject, get aborted(){return aborted;}});
      return task;
    } },
  }) });
  store.getState().setDocument('doc');
  return {store,tasks};
}
const batch=(objectNumber,nextCursor=null)=>({matches:[{page:{objectNumber},segments:[{rect:{x:1,y:2,width:3,height:4}}]}],nextCursor,pagesSearched:1,pageCount:2});

test('new search replaces old highlights; failure clears partial batches', async t => {
  const {store,tasks}=setup();
  store.getState().run('first'); await settle(); tasks[0].resolve(batch(3)); await settle();
  assert.equal(store.getState().resultsByPage.size,1);
  store.getState().run('second'); assert.equal(store.getState().resultsByPage.size,0);
  await settle(); tasks[1].resolve(batch(8,'cursor')); await settle();
  assert.equal(store.getState().resultsByPage.has(0),false);
  assert.equal(store.getState().resultsByPage.get(1)[0].resultIndex,0);
  assert.equal(tasks[2].request.cursor,'cursor');
  t.mock.method(console,'error',()=>{}); tasks[2].reject(new Error('Search failed')); await settle();
  assert.equal(store.getState().results.length,0);
  assert.equal(store.getState().resultsByPage.size,0);
  assert.equal(store.getState().loading,false);
});
test('an obsolete cursor response cannot replace a newer search', async () => {
  const {store,tasks}=setup();
  store.getState().run('old'); await settle();
  store.getState().run('new'); await settle();
  assert.equal(tasks[0].aborted,true);
  tasks[1].resolve(batch(8)); await settle(); tasks[0].resolve(batch(3,'old-cursor')); await settle();
  assert.equal(tasks.length,2);
  assert.deepEqual(store.getState().results.map(hit=>hit.pageIndex),[1]);
});
