# 对标评论区作为需求材料

日常选题默认从已认可的对标账号作品评论中识别目标用户任务；不能用本人作品评论替代。本人账号回流归douyin-extractor，仅作独立补充。用户明确指定博主时建立或沿用本批scope；没有新指定时沿用当前有效且已授权的对标scope。其他作者走授权公共研究、RedFox或现有登录态 Ego 浏览器。服务拒绝保留失败，备用成功不改写原失败；SDK没有的评论方法不能当作接口。

## 读取与恢复

research-config.json列scope_id、规范主页URL数组profiles及collection预算。日常选题缓存超过7天或未覆盖近期非置顶作品时必须刷新。先读当前ego-browser Skill。在Ego nodejs中import本Skill scripts/collect_comments.mjs，调用run({taskSpace,configPath,output,spaceId})；每轮只创建一个 TaskSpace，并在后续轮次复用同一 `spaceId`。当前空间消失、结束或发生阻断时不得另开空间绕过；按 Ego Skill 停止并请用户恢复/提供可继续的空间。结果为failed/partial或需要用户控制时不调用 `finish()`；只有本轮成功且无需恢复时才关闭空间。参数显式传入，不假定shell环境进入Ego运行时。

读取页面实际收到的公开作品/评论响应，不保存Cookie或签名URL。DOM限定user-post-list，排除SEO页脚和相关推荐。视频sec_uid必须与指定主页一致；有create_time按发布时间排序，置顶不等于最新。只有DOM而无日期时写“可见非置顶样本，最新未核验”。

评论按实际cursor/has_more分页、稳定ID去重、核验视频归属。空响应未见结束标记不能称完整。顶层与回复分别统计，原正文、父评论ID、点赞及时间缺失null，不保存评论者资料。达到预算、分页不推进或平台拒绝时保留原因与游标。平台隐藏、折叠、删除评论不属于可读范围；total不直接当顶层分母。

默认每账号2条非置顶视频、每视频20页，读使用方配置。resumeIncomplete({taskSpace,output,spaceId,maxPages})只续当前has_more=1的作品，归档原结果后合并稳定ID并保留reused_from，最多200页；拒绝后停该路，不换身份或绕过验证。重新采集也先归档，不抹掉失败。

## 审读与选题

collection.json保存事实；demand-signals.json另存scope_id、signals。每项task、interpretation、next_test、audience_cells、capability_cells、reviewed_at、evidence[{video_id,comment_id}]。原文按稳定ID关联集合，不能用不相符的excerpt冒充证据。任务与匹配是编辑判断。

区分具体任务、卡住步骤、实际尝试、泛赞、资源索取、CTA诱导与圈内账号问题。求资料数量不等于独立需求人数；没有去标识评论者依据不报不同用户高频。逐条审读而非关键词评分。选题有本人材料、中文入口和成果验证，不搬博主人设与独特案例；评论只触发受影响组合重审，不自动建作品。已采集、正文齐、已审读、亲测和用户认可分别记录。
