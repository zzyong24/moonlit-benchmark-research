import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCommentPage, mergeCommentPages, safeErrorDetail } from '../scripts/collect_comments.mjs'
test('browser failures retain useful diagnostics without signed URL credentials', () => {
  const detail=safeErrorDetail(Object.assign(new Error('Navigation failed at https://www.douyin.com/user/id?msToken=secret&signature=secret'),{name:'PageNavigationError'}))
  assert.match(detail,/PageNavigationError: Navigation failed at https:\/\/www\.douyin\.com\/user\/id/)
  assert.doesNotMatch(detail,/secret/)
})
test('comments must belong to the requested video and retain stable IDs', () => {
  assert.throws(() => normalizeCommentPage({status_code:0,comments:[{cid:'1',aweme_id:'wrong',text:'问题'}]}, '123'), /video/)
  assert.throws(() => normalizeCommentPage({status_code:0,comments:[{aweme_id:'123',text:'问题'}]}, '123'), /identity/)
})
test('duplicate pages cannot impersonate complete pagination; replies stay independent', () => {
  const row={cid:'1',aweme_id:'123',text:'怎么导出？',reply_comment_total:3}
  const a=normalizeCommentPage({status_code:0,comments:[row],cursor:5,has_more:1,total:9},'123')
  const partial=mergeCommentPages([a,a])
  assert.equal(partial.comments.length,1);assert.equal(partial.top_complete,false);assert.equal(partial.reply_complete,false)
  const b=normalizeCommentPage({status_code:0,comments:[row],cursor:10,has_more:0,total:9},'123')
  assert.equal(mergeCommentPages([a,b]).top_complete,true)
})
test('empty errors and absent end flags cannot be fresh complete data', () => {
  assert.throws(()=>normalizeCommentPage({status_code:3201},'123'),/platform/)
  const unknown=mergeCommentPages([normalizeCommentPage({status_code:0,comments:[]},'123')])
  assert.equal(unknown.top_complete,false)
})
