import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'

const publicProfile = url => /^https:\/\/www\.douyin\.com\/user\/MS4[\w.-]+$/.test(url)
const integer = value => Number.isFinite(value) ? value : null
export function safeErrorDetail(error) {
  const name=String(error?.name||'Error').slice(0,80)
  const message=String(error?.message||'').replace(/https?:\/\/[^\s"'<>]+/g,value=>{try{const u=new URL(value);return `${u.origin}${u.pathname}`}catch{return '[url]'}}).replace(/([?&](?:token|signature|msToken|webid|cookie)=)[^&#\s]*/gi,'$1[redacted]').slice(0,240)
  return message?`${name}: ${message}`:name
}
export function normalizeCommentPage(data, videoId) {
  if(data.status_code!==0) throw new Error('platform rejected comments')
  const normalize=(c,parent=null)=>{
    if(!c.cid || typeof c.text!=='string')throw new Error('comment identity missing')
    if(c.aweme_id && String(c.aweme_id)!==String(videoId))throw new Error('comment video mismatch')
    return {id:String(c.cid),video_id:String(videoId),parent_id:parent||(c.reply_id&&c.reply_id!=='0'?String(c.reply_id):null),text:c.text,likes:integer(c.digg_count),created_at:c.create_time?new Date(c.create_time*1000).toISOString():null,reply_count:integer(c.reply_comment_total)}
  }
  const comments=[]
  for(const c of data.comments||[]){comments.push(normalize(c));for(const r of c.reply_comment||[])comments.push(normalize(r,String(c.cid)))}
  return {comments,cursor:data.cursor??null,has_more:data.has_more??null,platform_total:data.total??null}
}
export function mergeCommentPages(pages) {
  const rows=new Map();for(const p of pages)for(const c of p.comments)rows.set(c.id,c)
  const comments=[...rows.values()], roots=comments.filter(c=>!c.parent_id)
  return {comments,top_count:roots.length,reply_count:comments.length-roots.length,top_complete:pages.at(-1)?.has_more===0,reply_complete:pages.length>0&&roots.every(c=>c.reply_count===0||(c.reply_count!==null&&comments.filter(r=>r.parent_id===c.id).length>=c.reply_count)),cursor:pages.at(-1)?.cursor??null,has_more:pages.at(-1)?.has_more??null,platform_total:pages.at(-1)?.platform_total??null,pages:pages.length}
}
const paths=new Set(['/aweme/v1/web/aweme/post/','/aweme/v1/web/aweme/detail/','/aweme/v1/web/comment/list/','/aweme/v1/web/comment/list/reply/'])
async function responses(page) {
  const events=await page.events(),rows=[]
  for(const e of events){if(e.method!=='Network.responseReceived')continue;const url=e.params?.response?.url;if(!url||!paths.has(new URL(url).pathname))continue
    try{const body=await page.cdp('Network.getResponseBody',{requestId:e.params.requestId});const data=JSON.parse(body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body);rows.push({endpoint:new URL(url).pathname,url,data})}catch{/* Body may be evicted; record missing data instead of guessing. */}
  }
  return rows
}
async function navigate(page,url,selector) {
  await page.events();await page.cdp('Network.enable')
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000})
  await page.waitForSelector(selector,{state:'visible',timeout:20000})
  return responses(page)
}
async function profile(page,url) {
  let packets=await navigate(page,url,'h1')
  await page.waitForSelector('[data-e2e="user-post-list"] a[href*="/video/"]',{state:'visible',timeout:20000})
  packets.push(...await responses(page))
  const dom=await page.evaluate(()=>({name:document.querySelector('h1')?.textContent?.trim(),count:[...document.querySelectorAll('h2')].map(x=>x.textContent).find(x=>/^作品/.test(x)),links:[...document.querySelectorAll('[data-e2e="user-post-list"] a[href*="/video/"]')].map(x=>({id:x.href.match(/\/video\/(\d+)/)?.[1],text:x.textContent?.trim(),is_top:x.textContent?.startsWith('置顶')})).filter(x=>x.id)}))
  const secId=url.split('/').at(-1),valid=new Map()
  for(const p of packets.filter(p=>p.endpoint==='/aweme/v1/web/aweme/post/'))for(const v of p.data.aweme_list||[]){if(v.author?.sec_uid!==secId)continue;valid.set(v.aweme_id,{id:v.aweme_id,text:v.desc,created_at:new Date(v.create_time*1000).toISOString(),is_top:!!v.is_top,comment_total:integer(v.statistics?.comment_count),likes:integer(v.statistics?.digg_count)})}
  const videos=valid.size?[...valid.values()].sort((a,b)=>b.created_at.localeCompare(a.created_at)):[...new Map(dom.links.map(v=>[v.id,{...v,created_at:null,comment_total:null,likes:null}])).values()]
  const last=packets.filter(p=>p.endpoint==='/aweme/v1/web/aweme/post/').at(-1)
  return {sec_uid:secId,name:dom.name,url,platform_work_count:Number(dom.count?.replace(/\D/g,''))||null,videos,metadata_method:valid.size?'browser_response':'visible_profile',metadata_complete:last?.data.has_more===0,metadata_has_more:last?.data.has_more??null,metadata_cursor:last?.data.max_cursor??null}
}
async function video(page,id,secId,limits,previous=null) {
  const url=`https://www.douyin.com/video/${id}`
  let packets=await navigate(page,url,'[data-e2e="comment-list"]')
  // Wait on public content, including a legitimate empty comment area.
  await page.waitForFunction(()=>document.querySelector('[data-e2e="comment-item"]')||document.querySelector('[data-e2e="comment-list"]')?.textContent?.includes('暂无'),undefined,{timeout:12000}).catch(()=>{})
  packets.push(...await responses(page));await page.evaluate(()=>document.querySelectorAll('video').forEach(v=>v.pause()))
  let detail=packets.filter(p=>p.endpoint==='/aweme/v1/web/aweme/detail/'&&p.data.aweme_detail?.aweme_id===id).at(-1)?.data.aweme_detail
  const owner=detail?.author?.sec_uid||await page.evaluate(expected=>[...document.querySelectorAll('a[href*="/user/"]')].find(a=>new URL(a.href).pathname===`/user/${expected}`)?.href,secId)
  if(!owner || (detail&&owner!==secId))throw new Error('video owner not verified')
  let packet=packets.filter(p=>p.endpoint==='/aweme/v1/web/comment/list/'&&new URL(p.url).searchParams.get('aweme_id')===id).at(-1)
  if(!packet){
    await page.evaluate(()=>{const list=document.querySelector('[data-e2e="comment-list"]');list?.scrollIntoView({block:'end'});let el=list;while(el&&!(el.scrollHeight>el.clientHeight+150&&['auto','scroll'].includes(getComputedStyle(el).overflowY)))el=el.parentElement;if(el)el.scrollTop=el.scrollHeight})
    await page.waitForFunction(()=>performance.getEntriesByType('resource').some(x=>{try{return new URL(x.name).pathname==='/aweme/v1/web/comment/list/'}catch{return false}}),undefined,{timeout:8000}).catch(()=>{})
    packets=await responses(page);packet=packets.filter(p=>p.endpoint==='/aweme/v1/web/comment/list/'&&new URL(p.url).searchParams.get('aweme_id')===id).at(-1)
  }
  const pages=previous?.has_more===1?[{comments:previous.comments,cursor:previous.cursor,has_more:1,platform_total:previous.platform_total}]:[];let reason=null
  if(packet){
    // The first client response may start after SSR rows. Explicit cursor 0 is required.
    let cursor=previous?.has_more===1?previous.cursor:0;const seen=new Set()
    for(let n=0;n<limits.max_comment_pages;n++){
      if(seen.has(cursor)){reason='cursor_repeated';break}seen.add(cursor)
      const result=await page.evaluate(async({base,cursor})=>{const u=new URL(base);u.searchParams.set('cursor',String(cursor));const r=await fetch(u,{credentials:'include'});let j;try{j=await r.json()}catch{return {error:'non_json',http:r.status}}return {data:j,http:r.status}},{base:packet.url,cursor})
      if(result.error||result.http!==200||result.data?.status_code!==0){reason=result.error||'platform_rejected';break}
      const p=normalizeCommentPage(result.data,id);pages.push(p);if(p.has_more===0)break;if(p.cursor===null){reason='cursor_missing';break}cursor=p.cursor
    }
    if(pages.at(-1)?.has_more===1&&!reason)reason='page_budget_reached'
  }else reason='comment_response_not_available'
  const merged=mergeCommentPages(pages)
  const title=detail?.desc||await page.evaluate(()=>document.querySelector('h1')?.textContent||document.querySelector('h2')?.textContent||document.title)
  return {id,url,text:title,created_at:detail?.create_time?new Date(detail.create_time*1000).toISOString():null,...merged,status:pages.length?'success':'failed',reason,checked_at:new Date().toISOString(),reused_from:previous?.checked_at??null,reply_scope:'仅平台随顶层返回的公开回复；展开回复另需续采',scope_complete:merged.top_complete&&merged.reply_complete}
}
export async function resumeIncomplete({taskSpace,output,spaceId,maxPages=120}) {
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>200)throw new Error('resume budget invalid')
  const current=JSON.parse(await readFile(output,'utf8'));await atomic(path.join(path.dirname(output),'runs',`${current.checked_at.replace(/[:.]/g,'-')}.json`),current)
  const task=await taskSpace(spaceId??'对标评论需求采集'),page=task.page('p1')
  for(const p of current.profiles)for(let i=0;i<p.selected_videos.length;i++){
    const old=p.selected_videos[i];if(old.has_more!==1||old.cursor===null)continue
    try{p.selected_videos[i]=await video(page,old.id,p.sec_uid,{max_comment_pages:maxPages},old);p.checked_at=new Date().toISOString();p.last_success_at=p.checked_at}
    catch(e){old.resume_failure={checked_at:new Date().toISOString(),reason:e.name,error_detail:safeErrorDetail(e)}}
    current.checked_at=new Date().toISOString();await atomic(output,current)
    console.log(JSON.stringify({name:p.name,video_id:old.id,comments:p.selected_videos[i].comments.length,top_complete:p.selected_videos[i].top_complete,reply_complete:p.selected_videos[i].reply_complete}))
  }
  return {space_id:task.spaceId,status:current.status}
}
async function atomic(file,value){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,file)}
export async function run({taskSpace,configPath,output,spaceId}) {
  const config=JSON.parse(await readFile(configPath,'utf8'));if(!config.scope_id||!Array.isArray(config.profiles)||config.profiles.length>12||!config.profiles.every(publicProfile))throw new Error('explicit public profile scope required')
  const limits={videos_per_profile:2,max_comment_pages:20,...config.collection};if(limits.videos_per_profile<1||limits.videos_per_profile>5||limits.max_comment_pages<1||limits.max_comment_pages>40)throw new Error('collection budget invalid')
  const task=await taskSpace(spaceId??'对标评论需求采集'),page=task.page('p1')
  let previous={profiles:[]};try{previous=JSON.parse(await readFile(output,'utf8'));if(previous.scope_id!==config.scope_id)throw new Error('scope mismatch')}catch(e){if(e.code!=='ENOENT')throw e}
  if(previous.profiles.length)await atomic(path.join(path.dirname(output),'runs',`${(previous.checked_at||previous.started_at).replace(/[:.]/g,'-')}.json`),previous)
  const current={schema_version:1,scope_id:config.scope_id,started_at:new Date().toISOString(),checked_at:null,status:'running',collection:limits,profiles:[]}
  for(const url of config.profiles){const old=previous.profiles.find(p=>p.url===url);let p
    try{p=await profile(page,url);p.checked_at=new Date().toISOString();p.status='success';p.selected_videos=[]
      // When response dates are available, rank by publication time. DOM order never proves recency.
      const selected=p.videos.filter(v=>!v.is_top).slice(0,limits.videos_per_profile);p.selection_basis=p.metadata_method==='browser_response'?'本次平台返回作品按发布时间排序，最近作品样本':'可见非置顶作品样本；最新顺序未核验'
      for(const v of selected){try{p.selected_videos.push(await video(page,v.id,p.sec_uid,limits))}catch(e){p.selected_videos.push({id:v.id,url:`https://www.douyin.com/video/${v.id}`,text:v.text,status:'failed',checked_at:new Date().toISOString(),reason:e.name,error_detail:safeErrorDetail(e),comments:[],top_complete:false,reply_complete:false,scope_complete:false})}await atomic(output,{...current,profiles:[...current.profiles,p]})}
      p.status=p.selected_videos.some(v=>v.status==='success')?'partial':'failed';p.last_success_at=p.selected_videos.some(v=>v.status==='success')?new Date().toISOString():old?.last_success_at??null
    }catch(e){p={url,sec_uid:url.split('/').at(-1),name:old?.name??null,status:'failed',reason:e.name,error_detail:safeErrorDetail(e),checked_at:new Date().toISOString(),last_success_at:old?.last_success_at??null,selected_videos:[],previous_evidence:old?.checked_at??null}}
    p.attempts=[...(old?.attempts||[]),{checked_at:p.checked_at,status:p.status,reason:p.reason??null}].slice(-30);current.profiles.push(p);await atomic(output,current)
    console.log(JSON.stringify({name:p.name,status:p.status,videos:p.selected_videos?.length,comments:p.selected_videos?.reduce((sum,v)=>sum+(v.comments?.length||0),0)}))
  }
  current.checked_at=new Date().toISOString();current.status=current.profiles.every(p=>p.status==='success')?'success':current.profiles.some(p=>p.selected_videos?.some(v=>v.status==='success'))?'partial':'failed';await atomic(output,current)
  return {space_id:task.spaceId,profiles:current.profiles.length,status:current.status}
}
