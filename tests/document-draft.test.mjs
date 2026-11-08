import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDraft, draftBaseline, resolveTarget, encodeDraft, decodeDraft } from '../apps/renderer/document-draft.ts';
const annotation = (id, contents = 'old') => ({ id, type: 1, pageIndex: 0, contents, rect: { origin: { x: 1, y: 2 }, size: { width: 3, height: 4 } } });
test('draft stores net changes and deletions without copying unchanged annotations', () => {
 const baseline = draftBaseline([annotation('a'), annotation('b'), annotation('c')], { Name: 'old' });
 const draft = buildDraft('hash', 4, baseline, [annotation('a','new'), annotation('c'), annotation('d')], {Name:'new'});
 assert.deepEqual(draft.upsert.map(x=>x.item.annotation.id),['a','d']);
 assert.deepEqual(draft.removed,[{id:'b',pageIndex:0,index:1}]);
 assert.equal(draft.upsert[1].target,undefined);
 assert.deepEqual(draft.formValues,{Name:'new'});
 const undone = buildDraft('hash',5,baseline,baseline.annotations,baseline.formValues);
 assert.equal(undone.upsert.length+undone.removed.length,0);
});
test('draft round trip preserves dates and binary stamp appearances', () => {
 const draft=buildDraft('hash',1,draftBaseline([],{}),[annotation('stamp')],{});
 draft.upsert[0].item.annotation.created=new Date('2025-01-01T00:00:00Z');
 draft.upsert[0].item.ctx={ data:new Uint8Array([0,255,32,13]).buffer,mimeType:'application/pdf' };
 assert.deepEqual(decodeDraft(encodeDraft(draft)),draft);
});
test('existing annotations without persisted IDs resolve against the unchanged original',()=>{
 const reopened=[annotation('new-a'),annotation('new-b')];
 assert.equal(resolveTarget({id:'old-b',pageIndex:0,index:1},reopened).id,'new-b');
 assert.throws(()=>resolveTarget({id:'missing',pageIndex:1,index:0},reopened));
});
test('foreign swap files and malformed edits are rejected',()=>{
 assert.throws(()=>decodeDraft('VIM swap contents'));
 assert.throws(()=>decodeDraft('{"format":"pdf.ts/swp","version":9}'));
 const draft=buildDraft('hash',1,draftBaseline([],{}),[annotation('a')],{});
 draft.upsert[0].item.annotation.pageIndex=-1;
 assert.throws(()=>decodeDraft(encodeDraft(draft)));
});
