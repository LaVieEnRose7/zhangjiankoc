/**
 * 《杖剑传说》演示数据（首次启动自动注入，可在设置中一键清空）
 */
module.exports = function seed(db) {
  const has = db.prepare('SELECT COUNT(*) as c FROM campaigns').get();
  const seeded = db.prepare("SELECT value FROM settings WHERE key='seeded'").get();
  if (has.c > 0 || (seeded && seeded.value === '1')) return;

  console.log('[seed] 注入《杖剑传说》演示数据...');

  // ===== 营销任务 =====
  const campCols = `name,game_name,goal,target_audience,criteria,keywords,content_directions,version_event,focus_content,goals,focus_detail,prefs,risk_rules,rule_summary,target_platform,owner,agency,is_current,start_date,end_date,priority,status,created_by`;
  const campVals = `?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?`;
  const campIns = db.prepare(`INSERT INTO campaigns (${campCols}) VALUES (${campVals})`);

  const camp1 = campIns.run(
    '暑期资料片「星陨秘境」上线推广',
    '《杖剑传说》',
    '新资料片曝光量提升，带动新增注册，首日激活转化率≥3%，7日付费ROI≥0.8',
    '18-30岁 MMO/放置玩家，B站游戏区活跃用户',
    '1.选题与新资料片玩法强相关；2.创作者近期均播≥5万；3.内容形式优先攻略和整活；4.预估单条成本≤8000元；5.避开纯搬运和低质切片',
    '星陨秘境,新资料片,暑期,新职业,秘境攻略,抽卡,月卡',
    '新玩法前瞻攻略、新职业强度测评、秘境速通整活、平民抽卡规划',
    '「星陨秘境」资料片 v2.3',
    '新职业「星术师」强度测评与平民抽卡规划',
    JSON.stringify({ primary: ['新版本曝光', '角色认知'], secondary: ['用户拉新', 'KOC内容扩散'] }),
    JSON.stringify({ role: '新职业「星术师」', play: '秘境速通/整活', selling_point: '星陨秘境资料片·新职业强度', linkage: '', node: '暑期', cognition: '杖剑传说=新职业养老首选', gap: '缺少剧情向二创' }),
    JSON.stringify({ platform: ['B站'], creator_type: ['测评', '攻略', '整活'], content_form: ['攻略', '测评', '整活'], play_method: ['强度测评', '速通', '平民养成'], cycle: '7天', cost: 8000, same_day: 0, require_case: 1 }),
    JSON.stringify({ opinion: 'caution', copyright: 'forbid', char_error: 'caution', ip_unauth: 'forbid', exaggerate: 'caution', platform_rule: 'off', high_cost: 'caution', real_person: 'off', outdated: 'caution', koc_mismatch: 'off' }),
    '本期优先推荐：结合「星陨秘境」资料片与暑期节点、适合测评/攻略/整活类创作者、制作周期≤7天、存在历史成功案例（如平民攻略ROI 1.4+）的内容机会。自动规避版权风险与未授权IP使用（红线）；对舆情风险、过度夸大宣传、制作成本过高、角色设定错误保持谨慎。降低纯资讯搬运与过度依赖真人高成本拍摄内容的推荐权重。',
    'B站',
    '李媒介',
    '星垣互娱 MCN',
    1,
    '2026-07-15', '2026-08-31', '高', '执行中', '李媒介').lastInsertRowid;

  const camp2 = campIns.run(
    '周年庆预热·情怀向内容储备',
    '《杖剑传说》',
    '强化老玩家回流，回流率提升20%，重点铺情怀和版本回顾内容',
    '25-35岁流失老玩家、怀旧向游戏内容受众',
    '1.内容以情怀共鸣为主，不硬广；2.优先有长期粉丝黏性的中腰部UP主；3.发布时间需在8月20日周年庆前两周内',
    '周年庆,情怀,回归,老玩家,版本回顾,爷青回',
    '版本变迁回顾、老玩家回归体验、周年庆福利前瞻',
    '周年庆版本 v2.4 预热',
    '老玩家情怀向回流内容储备',
    JSON.stringify({ primary: ['老玩家回流', '内容生态建设'], secondary: ['联动传播', 'KOC内容扩散'] }),
    JSON.stringify({ role: '老玩家', play: '情怀向二创', selling_point: '周年庆·爷青回', linkage: '', node: '周年庆(8/20)', cognition: '杖剑传说=陪伴感IP', gap: '缺少新玩家引流' }),
    JSON.stringify({ platform: ['B站'], creator_type: ['剧情', '情怀', '杂谈'], content_form: ['剧情', '情怀', '盘点'], play_method: ['情怀回顾', '老玩家故事'], cycle: '14天', cost: 6000, same_day: 0, require_case: 0 }),
    JSON.stringify({ opinion: 'caution', copyright: 'forbid', char_error: 'caution', ip_unauth: 'forbid', exaggerate: 'caution', platform_rule: 'off', high_cost: 'caution', real_person: 'off', outdated: 'caution', koc_mismatch: 'off' }),
    '本期优先推荐：结合周年庆节点、适合剧情/情怀类创作者、唤起老玩家回流与内容生态建设的内容机会。规避版权与未授权IP（红线）；对舆情、夸大、成本、角色设定保持谨慎；降低纯新玩家拉新硬广权重。',
    'B站',
    '王运营',
    '情怀内容工作室',
    0,
    '2026-08-01', '2026-08-20', '中', '执行中', '王运营').lastInsertRowid;

  // ===== 候选热点 =====
  // 字段顺序: title,platform,category,heat,trend,source,source_label,url,description,tags,valid_until,risk_note,status
  const hotspots = [
    ['「星陨秘境」PV播放破百万，评论区热议新职业星术师','B站','游戏内',92,'上升','手动录入','B站热门内容','','官方PV发布48小时播放量破100万，新职业星术师讨论度最高，大量玩家求强度分析','新职业,星术师,PV,官方','2026-08-10',null,'候选'],
    ['B站游戏区流行「开局一把剑」挑战梗','B站','泛游戏',85,'上升','手动录入','B站热门内容','','多款武器类游戏UP主参与，单视频最高280万播放，梗格式易复制','整活,挑战,梗','2026-08-05',null,'候选'],
    ['玩家自制「杖剑传说地图彩蛋合集」意外走红','B站','游戏内',71,'平稳','手动录入','B站热门内容','','中型UP主自发产出，40万播放，评论区大量老玩家怀旧向留言','彩蛋,怀旧,老玩家','2026-07-30',null,'候选'],
    ['暑期学生党「平民玩家逆袭」题材热度上涨','B站','泛游戏',78,'上升','表格导入','B站热门内容','','暑期档惯例热点，零氪/月卡党攻略类内容互动率高','平民,零氪,攻略,月卡','2026-08-12',null,'候选'],
    ['竞品《幻塔物语》新版本口碑翻车，玩家寻找替代游戏','B站','泛游戏',66,'上升','表格导入','B站热门内容','','竞品差评潮，评论区出现「有没有类似游戏推荐」高频提问','竞品,替代,推荐','2026-08-02','竞品对比需注意官方口径，避免引战','候选'],
    ['「AI生成游戏攻略」争议话题登上热搜','微博','泛娱乐',58,'下降','表格导入','微博热点','','话题热度已过峰值，与游戏推广结合度低','AI,争议','2026-07-28','争议话题易引战，谨慎使用','候选'],
    ['抖音「一分钟看懂XX游戏」快节奏解说形式爆火','抖音','泛游戏',74,'平稳','手动录入','抖音热点榜','','快节奏浓缩解说形式适合新玩家转化，B站已有UP主模仿','解说,快节奏,新手','2026-08-08',null,'候选'],
    ['夏日祭二次元线下活动引发打卡热潮','B站','泛娱乐',62,'平稳','手动录入','B站热门内容','','线下活动关联度一般，需结合游戏IP衍生内容','二次元,线下,夏日祭','2026-08-01','线下活动需结合游戏IP二创，避免纯打卡','候选']
  ];
  const hsIns = db.prepare(`INSERT INTO hotspots (title,platform,category,heat,trend,source,source_label,url,description,tags,valid_until,risk_note,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const hsIds = hotspots.map(h => hsIns.run(...h, '李媒介').lastInsertRowid);

  // ===== 创作者（V3：能力画像/趋势/建议所需字段）=====
  // 一个「人」一条 creators 记录；平台级指标与账号角色放在 creator_accounts（避免作者信息冗余）
  const crCols = ['name','categories','coop_count','price','strengths','contact','status','notes',
    'account_type','agency','content_type','coop_cycle','willingness','stability','is_new','good_play','good_role','style','forms','avg_cycle_days','cost_ceiling','bad_direction'];
  const crIns = db.prepare(`INSERT INTO creators (${crCols.join(',')}) VALUES (${crCols.map(() => '?').join(',')})`);
  const creatorsSeed = [
    { name:'老王评游戏', categories:'测评,攻略', coop_count:4, price:7000, strengths:'数据严谨,粉丝信任度高,转化稳定', contact:'vx: laowang001', status:'可合作', notes:'历史合作ROI稳定在1.0以上',
      account_type:'个人', agency:'', content_type:'攻略,测评', coop_cycle:'2026Q2起（约5个月）', willingness:'高', stability:'高', is_new:0, good_play:'BOSS机制详解,新职业测评,强度测评', good_role:'星术师,高阶副本', style:'硬核数据向', forms:'视频,图文', avg_cycle_days:7, cost_ceiling:9000, bad_direction:'纯曝光整活,剧情向',
      accounts:[
        { platform:'B站', account_name:'老王评游戏', home_url:'https://space.bilibili.com/10001', fans:320000, avg_play:85000, avg_activation:3.6, avg_roi7:1.12, role:'创作', is_primary:1 },
        { platform:'抖音', account_name:'老王说游戏', home_url:'https://v.douyin.com/laowang', fans:150000, avg_play:60000, avg_activation:3.0, avg_roi7:0.90, role:'分发', is_primary:0 }
      ] },
    { name:'喵酱的游戏日常', categories:'整活,剧情', coop_count:2, price:5500, strengths:'脑洞大,标题党能力强,易出爆款', contact:'vx: miaojiang22', status:'可合作', notes:'爆款率高但波动大',
      account_type:'个人', agency:'', content_type:'整活,剧情', coop_cycle:'2026Q2起', willingness:'高', stability:'中', is_new:0, good_play:'武侠风整活,剧情短剧', good_role:'剑客,日常', style:'脑洞大,标题党', forms:'视频', avg_cycle_days:10, cost_ceiling:6500, bad_direction:'硬核攻略',
      accounts:[
        { platform:'B站', account_name:'喵酱的游戏日常', home_url:'https://space.bilibili.com/10002', fans:180000, avg_play:120000, avg_activation:2.8, avg_roi7:0.95, role:'创作', is_primary:1 },
        { platform:'抖音', account_name:'喵酱整活日记', home_url:'https://v.douyin.com/miaojiang', fans:90000, avg_play:80000, avg_activation:2.5, avg_roi7:0.80, role:'分发', is_primary:0 }
      ] },
    { name:'秘境速通菌', categories:'攻略,速通', coop_count:3, price:3800, strengths:'垂直度极高,核心玩家聚集', contact:'QQ: 33445566', status:'合作中', notes:'小而美，转化率全库第一',
      account_type:'个人', agency:'', content_type:'攻略,速通', coop_cycle:'2026Q2起', willingness:'中', stability:'高', is_new:0, good_play:'速通,低练度通关', good_role:'副本,秘境', style:'垂直硬核', forms:'视频', avg_cycle_days:9, cost_ceiling:4500, bad_direction:'泛娱乐',
      accounts:[
        { platform:'B站', account_name:'秘境速通菌', home_url:'https://space.bilibili.com/10003', fans:95000, avg_play:60000, avg_activation:4.2, avg_roi7:1.35, role:'创作', is_primary:1 }
      ] },
    { name:'阿飞说MMO', categories:'测评,杂谈', coop_count:1, price:12000, strengths:'头部影响力,曝光量大', contact:'商务对接群', status:'可合作', notes:'曝光强但转化一般，适合大节点',
      account_type:'个人', agency:'', content_type:'测评,杂谈', coop_cycle:'2026Q1起', willingness:'中', stability:'中', is_new:0, good_play:'头部测评,版本解读', good_role:'通用MMO', style:'观点犀利', forms:'视频,直播', avg_cycle_days:14, cost_ceiling:14000, bad_direction:'平民向',
      accounts:[
        { platform:'B站', account_name:'阿飞说MMO', home_url:'https://space.bilibili.com/10004', fans:450000, avg_play:150000, avg_activation:1.9, avg_roi7:0.62, role:'创作', is_primary:1 }
      ] },
    { name:'月卡党老张', categories:'攻略,省钱', coop_count:5, price:3000, strengths:'平民视角,粉丝黏性强,复购意愿高', contact:'vx: yueka_zhang', status:'可合作', notes:'平民攻略类首选',
      account_type:'个人', agency:'', content_type:'攻略,省钱', coop_cycle:'2026Q2起', willingness:'高', stability:'高', is_new:0, good_play:'月卡党养成,平民攻略', good_role:'平民玩家', style:'陪伴式', forms:'视频,图文', avg_cycle_days:7, cost_ceiling:3500, bad_direction:'氪金向',
      accounts:[
        { platform:'B站', account_name:'月卡党老张', home_url:'https://space.bilibili.com/10005', fans:72000, avg_play:48000, avg_activation:3.9, avg_roi7:1.28, role:'创作', is_primary:1 },
        { platform:'抖音', account_name:'老张省钱日记', home_url:'https://v.douyin.com/yueka', fans:40000, avg_play:30000, avg_activation:3.5, avg_roi7:1.05, role:'分发', is_primary:0 }
      ] },
    { name:'糖糖不吃糖', categories:'剧情,情怀', coop_count:0, price:6500, strengths:'情感共鸣类内容出圈率高', contact:'商务: tang@mcn.cn', status:'可合作', notes:'未合作过，周年庆情怀向候选',
      account_type:'个人', agency:'', content_type:'剧情,情怀', coop_cycle:'尚未合作', willingness:'高', stability:'中', is_new:1, good_play:'情怀叙事,情感共鸣', good_role:'老玩家,剧情', style:'情感共鸣', forms:'视频', avg_cycle_days:12, cost_ceiling:7000, bad_direction:'硬核数据',
      accounts:[
        { platform:'B站', account_name:'糖糖不吃糖', home_url:'https://space.bilibili.com/10006', fans:210000, avg_play:90000, avg_activation:null, avg_roi7:null, role:'创作', is_primary:1 }
      ] },
    { name:'一分钟游戏君', categories:'解说,快节奏', coop_count:1, price:4500, strengths:'快节奏剪辑,新手向友好', contact:'vx: 1min_game', status:'可合作', notes:'适合新玩家转化向内容',
      account_type:'个人', agency:'', content_type:'解说,快节奏', coop_cycle:'2026Q2起', willingness:'中', stability:'中', is_new:0, good_play:'快节奏解说,新手向', good_role:'新手', style:'快剪', forms:'视频', avg_cycle_days:6, cost_ceiling:5000, bad_direction:'深度攻略',
      accounts:[
        { platform:'B站', account_name:'一分钟游戏君', home_url:'https://space.bilibili.com/10007', fans:130000, avg_play:110000, avg_activation:3.1, avg_roi7:0.88, role:'创作', is_primary:1 }
      ] },
    { name:'电竞小辣椒', categories:'切片,整活', coop_count:1, price:9000, strengths:'抖音流量大', contact:'MCN对接', status:'暂停', notes:'上次合作转化差，暂停观察',
      account_type:'MCN', agency:'星垣互娱 MCN', content_type:'切片,整活', coop_cycle:'2026Q1起（已暂停）', willingness:'低', stability:'低', is_new:0, good_play:'切片混剪,挑战', good_role:'通用', style:'流量向', forms:'短视频', avg_cycle_days:5, cost_ceiling:10000, bad_direction:'深度内容',
      accounts:[
        { platform:'抖音', account_name:'电竞小辣椒', home_url:'https://v.douyin.com/xxx', fans:560000, avg_play:200000, avg_activation:1.2, avg_roi7:0.41, role:'创作', is_primary:1 },
        { platform:'B站', account_name:'辣椒切片君', home_url:'https://space.bilibili.com/10008', fans:80000, avg_play:40000, avg_activation:1.0, avg_roi7:0.35, role:'分发', is_primary:0 }
      ] }
  ];
  const crIds = creatorsSeed.map(c => crIns.run(...crCols.map(k => (c[k] === undefined ? null : c[k]))).lastInsertRowid);
  // 平台账号（一个人可挂多个平台，主平台创作、副平台仅分发）
  const caccCols = ['creator_id','platform','account_name','home_url','fans','avg_play','avg_activation','avg_roi7','role','is_primary'];
  const caccIns = db.prepare(`INSERT INTO creator_accounts (${caccCols.join(',')}) VALUES (${caccCols.map(() => '?').join(',')})`);
  creatorsSeed.forEach((c, i) => c.accounts.forEach(a => caccIns.run(crIds[i], a.platform, a.account_name, a.home_url, a.fans || 0, a.avg_play || 0, a.avg_activation === undefined ? null : a.avg_activation, a.avg_roi7 === undefined ? null : a.avg_roi7, a.role || '创作', a.is_primary ? 1 : 0)));

  // ===== 案例库（重构：三来源 + 待确认系统发现 + 结构化分析）=====
  const caCols = ['title','platform','url','creator_id','creator_name','campaign_id','campaign_name','game_name','content_type','marketing_node','hotspot','play_method','creator_type','topic_tags','analysis_json','play_count','like_count','comment_count','activation_d1','roi_d7','cost','result','summary','source','confirm_status','is_favorite','is_verified','is_reusable','linked_opportunity_id','benchmark_met','review_conclusion','publish_date','created_by'];
  const caIns = db.prepare(`INSERT INTO cases (${caCols.join(',')}) VALUES (${caCols.map(() => '?').join(',')})`);
  const casesSeed = [
    // —— 系统发现（待确认，需用户确认收录）——
    { title:'竞品《星轨幻想》新职业PV破圈，玩法与杖剑相似', platform:'B站', url:'https://b23.tv/sys1', campaign_name:'星垣互娱 MCN', game_name:'《星轨幻想》', content_type:'整活', marketing_node:'暑期', hotspot:'竞品新职业PV', play_method:'新职业整活', creator_type:'整活类', topic_tags:'竞品,新职业,PV',
      analysis:{ structure:'竞品新职业PV采用「强度+梗」双线', why:'热度来自玩法相似度，可借势', borrowable:'借势玩法相似点做对比向内容（需注意官方口径）', irreproducible:'直接对比竞品易引战', risk_tip:'竞品对比需谨慎，避免引战', scenario:'暑期竞品借势' },
      result:null, summary:'系统从竞品动态中发现，待确认是否入库', source:'系统发现', confirm_status:'待确认', is_favorite:0, is_verified:0, is_reusable:1, publish_date:'2026-07-26', created_by:'系统' },
    { title:'抖音「游戏手机壳DIY」爆款，泛游戏周边灵感', platform:'抖音', url:'https://v.douyin.com/sys2', campaign_name:'星垣互娱 MCN', game_name:'其他', content_type:'切片', marketing_node:'暑期', hotspot:'泛游戏周边', play_method:'周边DIY', creator_type:'切片类', topic_tags:'抖音,周边,DIY',
      analysis:{ structure:'泛游戏周边DIY合集，单条300万播放', why:'形式轻、易模仿', borrowable:'周边/实物联动可延展游戏IP', irreproducible:'需实物授权与游戏IP结合', risk_tip:'实物授权风险', scenario:'周边联动' },
      result:null, summary:'系统从抖音热点中发现，待确认', source:'系统发现', confirm_status:'待确认', is_favorite:0, is_verified:0, is_reusable:1, publish_date:'2026-07-27', created_by:'系统' },
    // —— 系统发现（已收录示例）——
    { title:'网易《界外》剧情向二创出圈，情怀打法可借鉴', platform:'B站', url:'https://b23.tv/sys3', campaign_name:'星垣互娱 MCN', game_name:'《界外》', content_type:'剧情', marketing_node:'周年庆', hotspot:'情怀二创', play_method:'剧情向二创', creator_type:'剧情类', topic_tags:'竞品,情怀,二创',
      analysis:{ structure:'剧情向二创唤起老玩家共鸣', why:'情怀向内容转发率高', borrowable:'周年庆节点复用情怀向二创模板', irreproducible:'依赖IP情怀厚度', risk_tip:'避免魔改原作设定', scenario:'周年庆情怀' },
      result:null, summary:'系统发现，已确认收录为参考', source:'系统发现', confirm_status:'已收录', is_favorite:0, is_verified:0, is_reusable:1, publish_date:'2026-07-20', created_by:'系统' },
    // —— 人工新增（外部/历史参考）——
    { title:'新版本「深渊回廊」全BOSS机制详解', platform:'B站', url:'https://b23.tv/case1', creator_id:crIds[0], creator_name:'老王评游戏', campaign_id:camp1, campaign_name:'暑期资料片「星陨秘境」上线推广', game_name:'《杖剑传说》', content_type:'攻略', marketing_node:'版本上线', hotspot:'版本攻略', play_method:'BOSS机制详解', creator_type:'测评类', topic_tags:'版本攻略,BOSS',
      analysis:{ structure:'版本更新后48h内发布抢搜索流量', why:'标题带"全BOSS"点击率高', borrowable:'版本更新抢首发攻略打法', irreproducible:'依赖实机素材', risk_tip:'使用官方素材', scenario:'版本上线' },
      play_count:420000, like_count:28000, comment_count:3600, activation_d1:4.1, roi_d7:1.32, cost:7000, result:'爆款', summary:'版本更新后48小时内发布抢占搜索流量是关键', source:'人工新增', confirm_status:'已收录', is_favorite:0, is_verified:1, is_reusable:1, publish_date:'2026-03-18', created_by:'李媒介' },
    { title:'当我把杖剑传说玩成了武侠游戏', platform:'B站', url:'https://b23.tv/case2', creator_id:crIds[1], creator_name:'喵酱的游戏日常', campaign_id:camp1, campaign_name:'暑期资料片「星陨秘境」上线推广', game_name:'《杖剑传说》', content_type:'整活', marketing_node:'版本上线', hotspot:'跨风格整活', play_method:'武侠风整活', creator_type:'整活类', topic_tags:'整活,跨风格,梗',
      analysis:{ structure:'整活类曝光极强', why:'曝光强但转化偏低', borrowable:'整活卡点反转结构', irreproducible:'同质化易卷', risk_tip:'避免低俗引战', scenario:'拉新曝光' },
      play_count:680000, like_count:52000, comment_count:8900, activation_d1:2.2, roi_d7:0.87, cost:5500, result:'爆款', summary:'整活类曝光极强但转化偏低，适合拉新曝光不适合冲ROI', source:'人工新增', confirm_status:'已收录', is_favorite:1, is_verified:1, is_reusable:1, publish_date:'2026-03-25', created_by:'李媒介' },
    { title:'零氪30天：我在杖剑传说活得怎么样', platform:'B站', url:'https://b23.tv/case3', creator_id:crIds[4], creator_name:'月卡党老张', campaign_id:camp1, campaign_name:'暑期资料片「星陨秘境」上线推广', game_name:'《杖剑传说》', content_type:'攻略', marketing_node:'暑期', hotspot:'平民养成', play_method:'月卡党养成', creator_type:'攻略类', topic_tags:'零氪,平民,长线',
      analysis:{ structure:'平民视角+周期陪伴感', why:'评论区转化提问多，性价比最高', borrowable:'平民陪伴式系列打法', irreproducible:'题材易同质化需人设差异', risk_tip:'原创无版权风险', scenario:'暑期长线' },
      play_count:150000, like_count:18000, comment_count:4200, activation_d1:4.6, roi_d7:1.41, cost:3000, result:'爆款', summary:'平民视角+周期陪伴感，评论区转化提问多，性价比最高的内容类型', source:'人工新增', confirm_status:'已收录', is_favorite:1, is_verified:1, is_reusable:1, publish_date:'2026-04-10', created_by:'李媒介' },
    { title:'一分钟看懂杖剑传说新赛季', platform:'B站', url:'https://b23.tv/case6', creator_id:crIds[6], creator_name:'一分钟游戏君', campaign_id:camp1, campaign_name:'暑期资料片「星陨秘境」上线推广', game_name:'《杖剑传说》', content_type:'解说', marketing_node:'版本上线', hotspot:'新赛季', play_method:'快节奏解说', creator_type:'解说类', topic_tags:'快节奏,新手,赛季',
      analysis:{ structure:'快节奏浓缩解说', why:'完播率高', borrowable:'新手向快节奏解说模板', irreproducible:'需持续追版本', risk_tip:'原创', scenario:'新玩家转化' },
      play_count:175000, like_count:9800, comment_count:1500, activation_d1:3.0, roi_d7:0.85, cost:4500, result:'良好', summary:'快节奏解说适合投新手向节点，完播率高', source:'人工新增', confirm_status:'已收录', is_favorite:0, is_verified:1, is_reusable:1, publish_date:'2026-05-08', created_by:'李媒介' },
    { title:'外部参考：米哈游《绝区零》首日攻略流量打法', platform:'B站', url:'https://b23.tv/ext1', campaign_name:'星垣互娱 MCN', game_name:'《绝区零》', content_type:'攻略', marketing_node:'版本上线', hotspot:'首日攻略', play_method:'首发攻略', creator_type:'攻略类', topic_tags:'竞品,首日攻略',
      analysis:{ structure:'新游首日攻略流量红利明显', why:'借势新游热度', borrowable:'新游/新版本首发攻略抢流量打法', irreproducible:'需紧跟版本', risk_tip:'官方素材', scenario:'版本上线' },
      result:null, summary:'人工新增的外部竞品参考案例', source:'人工新增', confirm_status:'已收录', is_favorite:0, is_verified:0, is_reusable:1, publish_date:'2026-06-20', created_by:'李媒介' },
    // —— 项目执行结果（由机会沉淀）——
    { title:'平民玩家暑期逆袭攻略系列（项目执行）', platform:'B站', url:'https://b23.tv/demo51', creator_id:crIds[4], creator_name:'月卡党老张', campaign_id:camp1, campaign_name:'暑期资料片「星陨秘境」上线推广', game_name:'《杖剑传说》', content_type:'攻略', marketing_node:'暑期', hotspot:'平民逆袭', play_method:'月卡党养成', creator_type:'攻略类', topic_tags:'平民,月卡,养成',
      analysis:{ structure:'第1期数据超预期，第2期连载', why:'达到项目基准', borrowable:'平民陪伴式系列可复用', irreproducible:'题材易同质化', risk_tip:'原创', scenario:'暑期长线' },
      play_count:168000, like_count:19500, comment_count:4600, activation_d1:4.4, roi_d7:1.38, cost:3000, result:'良好', summary:'第1期数据超预期，第2期7月28日发布', source:'项目执行结果', confirm_status:'已收录', is_favorite:1, is_verified:1, is_reusable:1, linked_opportunity_id:null, benchmark_met:1, review_conclusion:'ROI1.38、激活4.4%，达项目基准，建议列为长期保留题材', publish_date:'2026-07-21', created_by:'李媒介' },
    { title:'星术师新职业首发攻略卡位（项目执行·制作中）', platform:'B站', url:'', creator_id:crIds[0], creator_name:'老王评游戏', campaign_id:camp1, campaign_name:'暑期资料片「星陨秘境」上线推广', game_name:'《杖剑传说》', content_type:'攻略', marketing_node:'版本上线', hotspot:'星术师首发', play_method:'新职业测评', creator_type:'攻略类', topic_tags:'新职业,星术师,测评',
      analysis:{ structure:'脚本确认阶段，待资料片实机素材', why:'数据待回收', borrowable:'新职业首发抢搜索打法', irreproducible:'依赖实机素材排期', risk_tip:'官方素材', scenario:'版本上线' },
      play_count:0, like_count:0, comment_count:0, activation_d1:null, roi_d7:null, cost:7000, result:'一般', summary:'制作中，数据待回收', source:'项目执行结果', confirm_status:'已收录', is_favorite:0, is_verified:0, is_reusable:1, linked_opportunity_id:null, benchmark_met:0, review_conclusion:'待发布后回收数据', publish_date:'2026-07-28', created_by:'李媒介' }
  ];
  casesSeed.forEach(c => {
    const v = caCols.map(k => k === 'analysis_json' ? (c.analysis ? JSON.stringify(c.analysis) : null) : (c[k] !== undefined ? c[k] : null));
    caIns.run(...v);
  });

  // ===== 机会 =====
  const opIns = db.prepare(`INSERT INTO opportunities (title,hotspot_id,campaign_id,status,rule_score,ai_score,ai_analysis,direction,decision,decision_by,matched_creator_ids,assignee,deadline,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const op1 = opIns.run('星术师新职业首发攻略卡位', hsIds[0], camp1, '创作中', 88, 86,
    '与「星陨秘境」推广强相关，官方PV热度正处上升期，攻略需求明确。历史案例显示版本攻略类在更新后48小时内发布可获得搜索流量红利。建议优先匹配攻略型高转化创作者。',
    '新职业星术师全面强度测评+平民养成路线，抢在资料片上线后24h内首发',
    '值得做：热度高+任务强相关+历史攻略类ROI表现好','李媒介', String(crIds[0])+','+String(crIds[4]), '李媒介','2026-07-30','李媒介','2026-07-24 10:00:00').lastInsertRowid;
  const op2 = opIns.run('「开局一把剑」挑战梗植入', hsIds[1], camp1, '已采纳', 76, 72,
    '梗热度高且格式易复制，但整活类历史转化偏低（参考案例ROI 0.87）。建议作为曝光向内容，控制预算，不承担ROI考核。',
    '用杖剑传说武器系统玩「开局一把剑」挑战，结尾自然引出新资料片武器',
    '值得做（曝光向）：控制成本≤6000','王运营', '', '王运营','2026-08-05','李媒介','2026-07-25 14:30:00').lastInsertRowid;
  const op3 = opIns.run('地图彩蛋合集×周年庆情怀预热', hsIds[2], camp2, '待判断', 68, null, null, null, null, null, '', '', null,'李媒介','2026-07-26 09:15:00').lastInsertRowid;
  const op4 = opIns.run('竞品翻车期「替代游戏推荐」卡位', hsIds[4], camp1, '不采用', 55, 48,
    '竞品口碑事件热度存在不确定性，直接对比容易引发双方玩家对立，品牌风险高。历史无同类成功案例。',
    null, '放弃：品牌风险大于收益，官方口径不宜直接对比竞品','王运营', '', '', null,'王运营','2026-07-25 16:00:00').lastInsertRowid;
  const op5 = opIns.run('平民玩家暑期逆袭攻略系列', hsIds[3], camp1, '已验证', 84, 82,
    '暑期学生党目标人群高度重合，历史案例「零氪30天」ROI 1.41 验证了该题材的转化能力。建议复用月卡党老张，做成2期系列。',
    '「暑期30天月卡党养成计划」系列，2期连载，突出低成本高回报',
    '值得做：历史验证过的高ROI题材','李媒介', String(crIds[4]), '李媒介','2026-07-20','李媒介','2026-07-16 11:00:00').lastInsertRowid;

  // ===== 机会结构化方案演示数据（机会结论/推荐依据/风险判断/内容方向建议）=====
  const planUpd = db.prepare(`UPDATE opportunities SET platform=?,node=?,basis=?,risk_json=?,direction_json=? WHERE id=?`);
  planUpd.run('B站', '星陨秘境资料片上线',
    JSON.stringify({ version_fit: '与「星陨秘境」版本强相关，新职业首发窗口期', hotspot_dev: '官方PV热度上升，攻略搜索需求明确', cases: '案例库「零氪30天」ROI1.41验证攻略题材转化', history_perf: '历史攻略类48h内发布有搜索红利', creators: '适配攻略型高转化创作者(老王评游戏)', feasibility: '素材依赖资料片实机，可前置脚本' }),
    JSON.stringify({ opinion: { level: '低', note: '官方正向内容，舆情风险低' }, copyright: { level: '低', note: '使用官方素材' }, character: { level: '低', note: '星术师为新职业设定清晰' }, difficulty: { level: '中', note: '需抢首发热度，制作排期紧' }, expiry: { level: '中', note: '依赖资料片上线窗口' }, irreproducible: { level: '低', note: '攻略题材可复用' } }),
    JSON.stringify({ core: '星术师新职业全面强度测评+平民养成路线', angle: '抢资料片上线后24h内首发，绑定搜索流量', structure: 'PV亮点→强度梯度演示→平民配装→抽卡规划', must_show: '新职业定位/获取方式/强度结论', forbid: '不得暗示付费必赢/不得夸大强度', ref_cases: '零氪30天月卡党养成' }), op1);
  planUpd.run('抖音', '暑期节点',
    JSON.stringify({ version_fit: '暑期学生党活跃，整活曝光向', hotspot_dev: '「开局一把剑」梗热度上升易复制', cases: '整活类历史ROI偏低(0.87)，作曝光', history_perf: '整活不承担ROI考核', creators: '适配整活/剧情类创作者', feasibility: '制作简单，可快速产出' }),
    JSON.stringify({ opinion: { level: '低', note: '搞笑向无争议' }, copyright: { level: '低', note: '原创整活' }, character: { level: '低', note: '武器系统设定清晰' }, difficulty: { level: '低', note: '格式易复制' }, expiry: { level: '中', note: '梗热度周期约2周' }, irreproducible: { level: '中', note: '同质化易卷' } }),
    JSON.stringify({ core: '用杖剑武器系统玩「开局一把剑」挑战，结尾引新资料片武器', angle: '卡点反转+搞笑失败合集', structure: '引入梗→挑战过程→翻车/成功→游戏引出', must_show: '新资料片武器外观', forbid: '避免引战/低俗', ref_cases: '开局一把剑挑战合集' }), op2);
  planUpd.run('B站', '暑期',
    JSON.stringify({ version_fit: '暑期学生党目标重合', hotspot_dev: '月卡党题材持续有搜索', cases: '「零氪30天」ROI1.41', history_perf: '历史验证高ROI', creators: '月卡党老张适配', feasibility: '可做成系列，复用数值' }),
    JSON.stringify({ opinion: { level: '低', note: '正向养成' }, copyright: { level: '低', note: '原创' }, character: { level: '低', note: '通用角色' }, difficulty: { level: '低', note: '数值可复用' }, expiry: { level: '低', note: '暑期长尾' }, irreproducible: { level: '低', note: '可系列化' } }),
    JSON.stringify({ core: '「暑期30天月卡党养成计划」系列2期连载', angle: '低成本高回报人设', structure: '目标→每日养成→成果→下期预告', must_show: '月卡性价比/养成路线', forbid: '不得承诺付费必赢', ref_cases: '零氪30天月卡党养成' }), op5);

  // ===== 创意模板库（演示：由已验证机会沉淀）=====
  const ctIns = db.prepare(`INSERT INTO creative_templates (name,core_logic,applicable_hotspot,applicable_node,creator_type,cost,cases,usage_count,validation,risks,source_opportunity_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  ctIns.run('新职业首发攻略卡位', '绑定新职业/资料片上线窗口，做强度测评+平民养成路线，抢搜索流量', '新职业/资料片上线', '版本上线', '攻略型创作者', 7000, '零氪30天 ROI1.41', 3, '多次验证高转化与搜索红利', '需抢首发热度，依赖实机素材', op1, '李媒介');
  ctIns.run('月卡党暑期养成系列', '以低成本高回报人设做系列养成，绑定暑期学生党', '月卡党/平民玩家题材', '暑期', '中腰部(攻略/剧情)创作者', 3000, '零氪30天 ROI1.41', 2, 'ROI稳定>1.3', '题材易同质化，需人设差异化', op5, '李媒介');
  ctIns.run('开服梗整活曝光', '用游戏机制玩热门梗/挑战，结尾自然引出版本内容，作曝光向', '热门梗/挑战', '任意', '整活/剧情类创作者', 6000, '整活类 ROI0.87(曝光向)', 1, '曝光达标但转化弱', '不承担ROI考核，控制预算', op2, '王运营');

  // ===== 执行记录（含创作者库合作执行记录扩展字段）=====
  const exCols = ['opportunity_id','creator_id','creator_name','stage','publish_url','publish_date','planned_date','play_count','like_count','comment_count','activation_d1','roi_d7','cost','income','exec_play_method','revision_count','on_time','coop_rating','accuracy','agency_feedback','note'];
  const exIns = db.prepare(`INSERT INTO executions (${exCols.join(',')}) VALUES (${exCols.map(() => '?').join(',')})`);
  const exVal = o => exCols.map(k => (o[k] === undefined ? null : o[k]));
  const executionsSeed = [
    { opportunity_id:op1, creator_id:crIds[0], creator_name:'老王评游戏', stage:'脚本确认', publish_url:'', publish_date:'2026-07-28', planned_date:'2026-07-28', play_count:0, like_count:0, comment_count:0, activation_d1:null, roi_d7:null, cost:7000, income:null, exec_play_method:'新职业测评', revision_count:0, on_time:1, coop_rating:null, accuracy:null, agency_feedback:null, note:'脚本已过一稿，等待资料片上线实机素材' },
    { opportunity_id:op1, creator_id:crIds[4], creator_name:'月卡党老张', stage:'沟通中', publish_url:'', publish_date:'2026-07-26', planned_date:'2026-07-26', play_count:0, like_count:0, comment_count:0, activation_d1:null, roi_d7:null, cost:3000, income:null, exec_play_method:'月卡党养成', revision_count:0, on_time:1, coop_rating:null, accuracy:null, agency_feedback:null, note:'已确认档期，待发星术师养成数值资料' },
    { opportunity_id:op5, creator_id:crIds[4], creator_name:'月卡党老张', stage:'数据回收', publish_url:'https://b23.tv/demo51', publish_date:'2026-07-21', planned_date:'2026-07-21', play_count:168000, like_count:19500, comment_count:4600, activation_d1:4.4, roi_d7:1.38, cost:3000, income:4140, exec_play_method:'月卡党养成', revision_count:1, on_time:1, coop_rating:'高', accuracy:'高', agency_feedback:null, note:'第1期数据超预期，第2期试水剧情向' },
    { opportunity_id:op1, creator_id:crIds[0], creator_name:'老王评游戏', stage:'数据回收', publish_url:'https://b23.tv/cr0a', publish_date:'2026-07-15', planned_date:'2026-07-14', play_count:92000, like_count:10800, comment_count:2600, activation_d1:3.8, roi_d7:1.15, cost:7000, income:8050, exec_play_method:'新职业测评', revision_count:1, on_time:1, coop_rating:'高', accuracy:'高', agency_feedback:null, note:'星术师首发测评，抢搜索红利' },
    { opportunity_id:op1, creator_id:crIds[0], creator_name:'老王评游戏', stage:'数据回收', publish_url:'https://b23.tv/cr0b', publish_date:'2026-07-22', planned_date:'2026-07-21', play_count:88000, like_count:10200, comment_count:2400, activation_d1:3.6, roi_d7:1.08, cost:7000, income:7560, exec_play_method:'BOSS机制详解', revision_count:1, on_time:1, coop_rating:'高', accuracy:'高', agency_feedback:null, note:'BOSS机制深度拆解' },
    { opportunity_id:op5, creator_id:crIds[4], creator_name:'月卡党老张', stage:'数据回收', publish_url:'https://b23.tv/cr4b', publish_date:'2026-07-28', planned_date:'2026-07-27', play_count:90000, like_count:9800, comment_count:2100, activation_d1:3.0, roi_d7:0.70, cost:3000, income:2100, exec_play_method:'情怀向陪伴', revision_count:2, on_time:1, coop_rating:'中', accuracy:'中', agency_feedback:null, note:'第2期试水剧情向陪伴内容，数据低于攻略基线' },
    { opportunity_id:op2, creator_id:crIds[1], creator_name:'喵酱的游戏日常', stage:'数据回收', publish_url:'https://b23.tv/cr1a', publish_date:'2026-07-12', planned_date:'2026-07-11', play_count:210000, like_count:26000, comment_count:5200, activation_d1:2.6, roi_d7:0.85, cost:5500, income:4675, exec_play_method:'武侠风整活', revision_count:2, on_time:1, coop_rating:'高', accuracy:'中', agency_feedback:null, note:'开局一把剑武侠整活，爆款' },
    { opportunity_id:op2, creator_id:crIds[1], creator_name:'喵酱的游戏日常', stage:'数据回收', publish_url:'https://b23.tv/cr1b', publish_date:'2026-07-24', planned_date:'2026-07-23', play_count:150000, like_count:18200, comment_count:3600, activation_d1:2.9, roi_d7:0.90, cost:5500, income:4950, exec_play_method:'剧情短剧', revision_count:1, on_time:1, coop_rating:'高', accuracy:'高', agency_feedback:null, note:'试水剧情短剧方向' },
    { opportunity_id:op1, creator_id:crIds[2], creator_name:'秘境速通菌', stage:'数据回收', publish_url:'https://b23.tv/cr2a', publish_date:'2026-07-16', planned_date:'2026-07-15', play_count:73000, like_count:8600, comment_count:1900, activation_d1:4.3, roi_d7:1.35, cost:3800, income:5130, exec_play_method:'速通低练度', revision_count:1, on_time:1, coop_rating:'高', accuracy:'高', agency_feedback:null, note:'低练度速通，核心玩家向' },
    { opportunity_id:op5, creator_id:crIds[2], creator_name:'秘境速通菌', stage:'数据回收', publish_url:'https://b23.tv/cr2b', publish_date:'2026-07-19', planned_date:'2026-07-18', play_count:69000, like_count:8100, comment_count:1700, activation_d1:4.1, roi_d7:1.30, cost:3800, income:4940, exec_play_method:'副本速通', revision_count:1, on_time:1, coop_rating:'高', accuracy:'高', agency_feedback:null, note:'星陨秘境副本速通' },
    { opportunity_id:op1, creator_id:crIds[3], creator_name:'阿飞说MMO', stage:'数据回收', publish_url:'https://b23.tv/cr3a', publish_date:'2026-07-14', planned_date:'2026-07-10', play_count:320000, like_count:30000, comment_count:7200, activation_d1:2.0, roi_d7:0.65, cost:12000, income:7800, exec_play_method:'版本解读测评', revision_count:3, on_time:0, coop_rating:'中', accuracy:'中', agency_feedback:'头部曝光强但转化弱，不建议承担ROI考核', note:'版本解读长视频，制作周期长' },
    { opportunity_id:op5, creator_id:crIds[6], creator_name:'一分钟游戏君', stage:'数据回收', publish_url:'https://b23.tv/cr6a', publish_date:'2026-07-18', planned_date:'2026-07-17', play_count:110000, like_count:12000, comment_count:2800, activation_d1:3.1, roi_d7:0.88, cost:4500, income:3960, exec_play_method:'快节奏解说', revision_count:1, on_time:1, coop_rating:'高', accuracy:'高', agency_feedback:null, note:'新手向快节奏解说' },
    { opportunity_id:op2, creator_id:crIds[7], creator_name:'电竞小辣椒', stage:'数据回收', publish_url:'https://v.douyin.com/cr7a', publish_date:'2026-07-13', planned_date:'2026-07-08', play_count:200000, like_count:24000, comment_count:6000, activation_d1:1.2, roi_d7:0.41, cost:9000, income:3690, exec_play_method:'切片混剪', revision_count:4, on_time:0, coop_rating:'低', accuracy:'低', agency_feedback:'上次合作转化差，暂停观察', note:'抖音切片混剪，流量大转化低' }
  ];
  executionsSeed.forEach(e => exIns.run(...exVal(e)));

  // 项目执行案例关联机会（案例种子先于机会创建，此处回填关联）
  db.prepare("UPDATE cases SET linked_opportunity_id=? WHERE title=?").run(op5, '平民玩家暑期逆袭攻略系列（项目执行）');
  db.prepare("UPDATE cases SET linked_opportunity_id=? WHERE title=?").run(op1, '星术师新职业首发攻略卡位（项目执行·制作中）');

  // ===== 周期复盘 / 内容经营分析 快照 =====
  const stats = JSON.stringify({period:'2026-07-13 ~ 2026-07-26', opportunities_created:5, executed:2, published:1, total_cost:13000, total_play:168000, avg_activation:4.4, avg_roi7:1.38, best:'平民玩家暑期逆袭攻略系列'});
  const rv = db.prepare(`INSERT INTO reviews (title,period_start,period_end,stats_json,content,ai_generated,status,confirmed_by,campaign_id,cycle_mode,period_label,analysis_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    '7月下旬双周复盘（演示）','2026-07-13','2026-07-26',stats,
    `## 周期概览
本周期共产生 5 个内容机会，判断通过 4 个、放弃 1 个，已发布 1 条，回收数据 1 条。

## 核心结论
1. 「平民/月卡党攻略」题材再次验证高转化（激活4.4%、ROI 1.38），建议列为长期保留题材。
2. 整活类机会（开局一把剑）按曝光向定位执行，需在发布后观察实际拉新效果。
3. 竞品对比类机会因品牌风险放弃，符合项目判断标准，此类热点后续可直接降权。

## 待改进
- 星术师攻略卡位执行偏慢，资料片上线前的物料协同需要提前一周启动。
- 候选热点中泛娱乐类（夏日祭、AI争议）与任务匹配度低，建议录入时先做初筛。`,
    1,'已确认','李媒介', camp1, 'task', '2026-07上旬',
    JSON.stringify({ overview:{ published:1, creators:1, completion:1.0, totalPlay:168000, totalInteraction:24100, baiZan:1, gaoQian:1, newPlays:1, avgRoi7:1.38, avgActivation:4.4, platforms:{'B站':1}, dataCompleteness:1.0 } })).lastInsertRowid;

  // —— 历史周期快照（用于「上周期 / 历史平均」对照）——
  const histRev = db.prepare(`INSERT INTO reviews (title,period_start,period_end,stats_json,content,ai_generated,status,confirmed_by,campaign_id,cycle_mode,period_label,analysis_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  histRev.run('2026Q1 经营分析（历史）','2026-01-01','2026-03-31', JSON.stringify({period:'2026Q1'}),
    'Q1 经营快照（历史对照基线）', 1,'已确认','李媒介', camp1, 'period', '2026Q1',
    JSON.stringify({ overview:{ published:18, creators:4, completion:0.85, totalPlay:2400000, totalInteraction:280000, baiZan:12, gaoQian:6, newPlays:3, avgRoi7:1.02, avgActivation:3.4, platforms:{'B站':16,'抖音':2}, dataCompleteness:0.90 } }));
  histRev.run('2026Q2 经营分析（历史）','2026-04-01','2026-06-30', JSON.stringify({period:'2026Q2'}),
    'Q2 经营快照（历史对照基线）', 1,'已确认','李媒介', camp1, 'period', '2026Q2',
    JSON.stringify({ overview:{ published:22, creators:5, completion:0.88, totalPlay:3100000, totalInteraction:360000, baiZan:15, gaoQian:8, newPlays:4, avgRoi7:1.08, avgActivation:3.6, platforms:{'B站':20,'抖音':2}, dataCompleteness:0.92 } }));

  // ===== 经验沉淀 =====
  const expIns = db.prepare(`INSERT INTO experiences (content,category,keywords,boost,source_review_id,status,created_by) VALUES (?,?,?,?,?,?,?)`);
  expIns.run('平民/月卡党攻略题材转化稳定（激活>4%，ROI>1.3），同类热点优先推荐','选题','平民,零氪,月卡,省钱,攻略',1,rv,'已确认','李媒介');
  expIns.run('版本更新后48小时内发布攻略可吃到搜索流量红利，攻略类机会截止时间要卡在版本上线+2天内','时机','版本,更新,攻略,首发',1,rv,'已确认','李媒介');
  expIns.run('纯切片/搬运类内容流量虚高转化差，相关热点降权处理','形式','切片,搬运',-1,rv,'已确认','王运营');
  expIns.run('竞品对比类热点品牌风险高，除非官方口径明确，否则不做','选题','竞品,对比,翻车',-1,rv,'已确认','王运营');
  expIns.run('整活类内容定位为曝光向，不承担ROI考核，成本控制在6000以内','形式','整活,梗,挑战',1,rv,'已确认','李媒介');

  // ===== 待办 =====
  const tdIns = db.prepare(`INSERT INTO todos (title,ref_type,ref_id,assignee,due_date,status,created_by) VALUES (?,?,?,?,?,?,?)`);
  tdIns.run('跟进老王评游戏脚本二稿确认','opportunity',op1,'李媒介','2026-07-28','待办','李媒介');
  tdIns.run('给月卡党老张发星术师养成数值资料','opportunity',op1,'李媒介','2026-07-27','待办','李媒介');
  tdIns.run('判断「地图彩蛋×周年庆」机会是否值得做','opportunity',op3,'王运营','2026-07-29','待办','李媒介');
  tdIns.run('回收「平民逆袭」第2期发布数据','opportunity',op5,'李媒介','2026-07-30','待办','王运营');

  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('seeded','1')").run();
  // 对刚注入的候选热点执行一次智能筛查（来源标注 + 宣发适配过滤）
  try { require('./schema').migrate(db); } catch (e) { console.warn('[seed] 筛查跳过:', e.message); }
  console.log('[seed] 演示数据注入完成');
};
