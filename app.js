"use strict";

const SAVE_KEY="lol_pro_life_save_v1",META_KEY="lol_pro_life_meta_v1",VERSION=1;
// 同月重复行动的收益/风险修正。只在 applyAction 执行期间偏离 1，事件与剧情调用 gain 时不受影响。
let actionMult=1,actionInjuryMult=1;
/* 电竞选手的生涯比电竞短得多：22~24岁开始衰退，26~28岁退役。
   decayAge/retireAge 是这套引擎里唯一定义年龄轴的地方，改这里就等于改整段人生长度。 */
const DIFFICULTIES={
  standard:{key:"standard",name:"标准",tag:"已经不轻松",desc:"成长偏慢、伤病更多、门槛更高。默认就比想象中难，适合第一次认真通关。",growth:.8,soft:1,injury:0.9,threshold:2,income:.85,expense:1,decayAge:24,retireAge:28},
  hard:{key:"hard",name:"困难",tag:"硬核",desc:"成长很慢、资源紧张、状态易崩，打不出成绩会被下放二队甚至降薪。需要精打细算每一个执行点。",growth:.64,soft:1.25,injury:1.2,threshold:5,income:.7,expense:1.25,decayAge:23,retireAge:27},
  brutal:{key:"brutal",name:"严酷",tag:"一步错步步错",desc:"巅峰短暂、手伤凶狠、账面永远紧张，一次贪婪可能毁掉整段生涯。大部分存档打不进一队。",growth:.5,soft:1.6,injury:1.6,threshold:9,income:.55,expense:1.6,decayAge:22,retireAge:26}
};
function diffOf(s){return DIFFICULTIES[s&&s.difficulty]||DIFFICULTIES.standard}
function softFactor(cur,d,lv=0){const t=lv*5;let f=cur>=88+t?.25:cur>=82+t?.4:cur>=75+t?.6:cur>=68+t?.8:1;if(cur>=68+t)f/=d.soft;return f}
/* ========== 判定内核 ==========
   cond() 把状态与精力压成一个 0.78~1.08 的系数；eff() 是所有判定读取属性的
   唯一入口。任何判定公式都不得再单独掺 form/fitness——那会双重计数。      */
function cond(s){return clamp(1+(s.form-55)/500+(s.fitness-72)/600,.78,1.08)}
/* 熬到手抖的时候，最先垮的是反应和操作，心态几乎不受影响。
   这张表的排序就是「一个人被打疲劳时按什么顺序变差」，不是配平出来的。 */
const COND_SENS={REA:1.4,END:1.3,MEC:1.2,LAN:1.0,AWA:.8,COM:.6,MEN:.4};
function eff(s,k){return s.attrs[k]*(1+(cond(s)-1)*COND_SENS[k])}
/* atk = 你在这局里能打出多少东西；def = 你有多不容易被打崩。
   分路不改这两条公式，只改综合评分的权重——公式改了会让辅助永远打不出评分。 */
function atk(s){return eff(s,"MEC")*.35+eff(s,"REA")*.25+eff(s,"LAN")*.20+eff(s,"COM")*.20}
function def(s){return eff(s,"AWA")*.60+eff(s,"END")*.25+eff(s,"MEN")*.15}
const ATTRS=[
  {key:"REA",name:"反应",sub:"手速与抓机会",icon:"»",w:.18},
  {key:"MEC",name:"操作",sub:"极限处理与命中",icon:"◎",w:.24},
  {key:"COM",name:"沟通",sub:"指挥与报点",icon:"▣",w:.09},
  {key:"LAN",name:"对线",sub:"补刀与换血",icon:"✦",w:.17},
  {key:"AWA",name:"意识",sub:"视野与地图",icon:"▰",w:.11},
  {key:"END",name:"体力",sub:"手速续航与作息",icon:"▲",w:.09},
  {key:"MEN",name:"心态",sub:"抗压与决胜局",icon:"◆",w:.12}
];
const ATTR_KEYS=ATTRS.map(a=>a.key);
/* ========== 五分路 ==========
   分路只做一件事：换掉综合评分的权重表。它不新增系统，但它决定了
   同样一套属性在不同位置上值多少钱——辅助把 24 点全丢进操作是自杀。
   每行权重之和必须是 1，改表时先算总和。 */
const POSITIONS=[
  {key:"top",name:"上单",chip:"TOP",sub:"单带与承伤",desc:"一个人在上路待满二十分钟。赢了没人提，输了全是你的锅。",
   w:{MEC:.20,REA:.14,COM:.06,LAN:.24,AWA:.10,END:.14,MEN:.12}},
  {key:"jug",name:"打野",chip:"JGL",sub:"节奏与视野",desc:"全队的节奏挂在你身上。四条路都会怪你不来，你只有两只手。",
   w:{MEC:.17,REA:.16,COM:.14,LAN:.05,AWA:.24,END:.11,MEN:.13}},
  {key:"mid",name:"中单",chip:"MID",sub:"输出与游走",desc:"最容易被看见的位置，也最容易被骂。所有摄像机都对着这条路。",
   w:{MEC:.25,REA:.18,COM:.08,LAN:.18,AWA:.11,END:.08,MEN:.12}},
  {key:"adc",name:"射手",chip:"BOT",sub:"后期与站位",desc:"团战里活得最久的那个人赢。你的手要在被三个人盯着时不抖。",
   w:{MEC:.24,REA:.20,COM:.07,LAN:.15,AWA:.08,END:.12,MEN:.14}},
  {key:"sup",name:"辅助",chip:"SUP",sub:"开团与指挥",desc:"数据面板上最难看的位置。但队伍散不散，取决于你说话有没有人听。",
   w:{MEC:.12,REA:.13,COM:.24,LAN:.06,AWA:.23,END:.09,MEN:.13}}
];
function posOf(s){return POSITIONS.find(p=>p.key===(s&&s.position))||POSITIONS[2]}
function posName(s){return posOf(s).name}
function attrW(s,key){return posOf(s).w[key]??(ATTRS.find(a=>a.key===key)?.w||0)}
// 创建页点数预算只有这一份：显示、加减按钮守卫、重开重置都从这里取，避免两份常数漂移。
const START_ALLOC={REA:4,MEC:4,COM:3,LAN:3,AWA:3,END:3,MEN:4},ALLOC_BUDGET=Object.values(START_ALLOC).reduce((a,b)=>a+b,0);
/* 出身档位是一张受校验的表：野生与体系互为镜像，未知档位一律回落到 normal。
   它不占分配点——你怎么开始打游戏这件事，本来就不是你选的。 */
const ORIGIN_TIERS={
  wild:{name:"网吧野生",tag:"十二岁包夜",adj:{END:-5,REA:3,LAN:2},
    desc:"手是黑网吧里练出来的，天赋顶，作息稀烂。"},
  normal:{name:"普通家庭",tag:"自己摸索",adj:{},
    desc:"一台家里的旧电脑，没人教也没人拦。七项都不加不减。"},
  academy:{name:"体系青训",tag:"被安排好的",adj:{END:5,REA:-3,LAN:-2},
    desc:"从小有训练表和营养师，稳，但少了点野性。"}
};
const TALENTS=[
  {id:"insane_hands",icon:"ϟ",name:"逆天手速",desc:"反应与对线训练收益+25%，极限操作类关键时刻成功率提高。",tags:["REA","LAN"]},
  {id:"kill_sense",icon:"◎",name:"杀人嗅觉",desc:"团战与单杀事件更容易转化为人头。",tags:["MEC","kill"]},
  {id:"big_heart",icon:"◆",name:"大心脏",desc:"心态成长+18%，S赛淘汰赛和决胜局表现更稳。",tags:["MEN","clutch"]},
  {id:"iron_wrist",icon:"▰",name:"铁腕",desc:"疲劳导致的手伤概率降低40%。",tags:["injury","END"]},
  {id:"teamfight_king",icon:"↥",name:"团战之王",desc:"大规模团战场景发动率提高，多杀概率上升。",tags:["MEC","teamfight"]},
  {id:"pool_master",icon:"⌁",name:"英雄池深",desc:"沟通训练收益+30%，BP 阶段可能直接偷到版本答案。",tags:["COM","draft"]},
  {id:"both_side",icon:"Ⅱ",name:"双修",desc:"打不熟的英雄不再明显掉水平，可选战术更多。",tags:["MEC","LAN"]},
  {id:"shotcaller",icon:"♛",name:"天生指挥",desc:"队友事件与国际赛适应更有利，更易成为队长。",tags:["MEN","team"]},
  {id:"game_iq",icon:"◇",name:"高游戏理解",desc:"复盘、视野与运营类行动收益+25%。",tags:["AWA","macro"]},
  {id:"engine",icon:"∞",name:"永动机",desc:"精力训练收益+25%，比赛后精力消耗降低。",tags:["END","fitness"]},
  {id:"thick_skin",icon:"▣",name:"抗压体质",desc:"替补、弹幕和网暴造成的状态损失减半。",tags:["MEN","media"]},
  {id:"scout_magnet",icon:"◉",name:"星探缘",desc:"试训事件与更高一级战队的报价概率提高。",tags:["scout","transfer"]},
  {id:"language_gift",icon:"A",name:"语言天分",desc:"韩语学习收益翻倍，海外适应更快。",tags:["language","overseas"]},
  {id:"childhood_bond",icon:"♥",name:"青梅羁绊",desc:"与安安相处时关系收益提高，冲突缓冲一次。",tags:["love","MEN"]},
  {id:"quick_healer",icon:"✚",name:"恢复力强",desc:"伤停时间减少1个月，理疗行动额外恢复。",tags:["recovery","injury"]},
  {id:"super_sub",icon:"↗",name:"奇兵",desc:"替补上场时状态加成，人头收益不低于首发的80%。",tags:["sub","kill"]},
  {id:"home_crowd",icon:"⌂",name:"主场宠儿",desc:"主场比赛状态更好，粉丝与人气增长更快。",tags:["home","fame"]},
  {id:"red_shirt",icon:"★",name:"为国出征",desc:"国际赛事名单门槛降低，国际赛表现小幅提高。",tags:["national","MEN"]},
  {id:"final_master",icon:"▲",name:"决赛先生",desc:"S赛决赛表现获得额外加成。",tags:["final","clutch"]},
  {id:"grinder",icon:"□",name:"训练模范",desc:"正式训练额外提升教练信任，偶尔触发双倍成长。",tags:["training","coach"]}
];

/* ========== 战队 ==========
   真实战队名仅用于文字化赛程与转会氛围，不含队标、队服与任何商业标识。
   强度是本作的虚构设定，不代表任何真实战力评价。 */
/* CQG（山城电竞）是全联盟里唯一一支虚构战队，因为这个故事扎根重庆——
   父亲的厂、楼下的网吧、本地高校的对手全在这儿，而 LPL 现实中没有重庆队。
   让玩家从某支真实豪门的青训营长出来，"父亲把你送到基地门口"那种写法就成了硬伤。
   它的实力 67 是全联盟垫底，玩家的第一份合同天然是保级队的合同。 */
const LPL_TEAMS=[
  ["BLG",92],["TES",90],["JDG",89],["LNG",88],["WBG",87],["AL",86],
  ["IG",82],["FPX",81],["OMG",80],["NIP",80],["EDG",79],["WE",78],
  ["TT",77],["RNG",76],["UP",75],["LGD",73],["RA",72],["CQG",67]
].map(([name,strength],i)=>({id:`lpl_${i}`,name,league:"LPL",strength,tier:strength>=87?1:strength>=79?2:3}));

const LCK_TEAMS=[
  ["T1",93],["Gen.G",93],["Hanwha Life",91],["KT Rolster",88],["Dplus KIA",86],
  ["Nongshim RedForce",81],["BNK FearX",79],["DN Freecs",78],["DRX",77],["OKBRO",75]
].map(([name,strength],i)=>({id:`lck_${i}`,name,league:"LCK",strength,tier:strength>=88?1:strength>=79?2:3}));

const CAMPUS_TEAMS=[
  ["重庆大学",58],["西南大学",57],["重庆邮电大学",56],["重庆交通大学",55],
  ["四川外国语大学",54],["重庆理工大学",53],["重庆师范大学",51],["西南政法大学",50],
  ["重庆工商大学",52],["重庆科技大学",49]
].map(([name,strength],i)=>({id:`cp_${i}`,name:`${name}电竞社`,league:"高校联赛",strength,tier:3}));

/* 洲际邀请赛与表演赛的对手池：跨赛区，强度中上。 */
const INTL_OPPONENTS=[
  {name:"T1",strength:93},{name:"Gen.G",strength:92},{name:"Hanwha Life",strength:90},{name:"G2 Esports",strength:88},
  {name:"Fnatic",strength:84},{name:"FlyQuest",strength:82},{name:"PSG Talon",strength:81},{name:"GAM Esports",strength:78}
];
/* MSI 参赛队：各赛区春季赛冠亚军。按强度分层，强的进淘汰赛池。 */
const MSI_POOL=[
  {name:"T1",strength:93},{name:"Gen.G",strength:92},{name:"Hanwha Life",strength:90},{name:"BLG",strength:91},
  {name:"JDG",strength:88},{name:"G2 Esports",strength:87},{name:"KT Rolster",strength:86},
  {name:"Fnatic",strength:83},{name:"FlyQuest",strength:81},{name:"PSG Talon",strength:80},{name:"GAM Esports",strength:77}
];
const MSI_GROUP_POOL=MSI_POOL.filter(t=>t.strength<86);   // Fnatic83 FlyQuest81 PSG80 GAM77
const MSI_ELITE_POOL=MSI_POOL.filter(t=>t.strength>=86);  // T193 Gen.G92 BLG91 HLE90 JDG88 G287 KT86
// S赛小组赛对手池（各赛区中上游）
const WORLDS_GROUP_POOL=[
  {name:"Fnatic",strength:84},{name:"FlyQuest",strength:82},{name:"G2 Esports",strength:87},{name:"100 Thieves",strength:79},
  {name:"PSG Talon",strength:81},{name:"GAM Esports",strength:78},{name:"paiN Gaming",strength:80},{name:"MAD Lions",strength:80},
  {name:"Team Liquid",strength:82},{name:"CTBC Flying Oyster",strength:80},{name:"Movistar KOI",strength:82},{name:"Vikings Esports",strength:77}
];
// S赛淘汰赛对手池（世界最强）
const WORLDS_ELITE_POOL=[
  {name:"T1",strength:93},{name:"Gen.G",strength:93},{name:"BLG",strength:92},{name:"Hanwha Life",strength:91},
  {name:"JDG",strength:90},{name:"TES",strength:89},{name:"KT Rolster",strength:88},{name:"LNG",strength:87},
  {name:"WBG",strength:87},{name:"Dplus KIA",strength:86},{name:"G2 Esports",strength:87},{name:"DRX",strength:84}
];
// 夏季赛季后赛（争 S 赛门票）的对手池：LPL 上半区
const PLAYOFF_POOL=LPL_TEAMS.filter(t=>t.strength>=79).map(t=>({name:t.name,strength:t.strength}));

const PROLOGUE=[
  {kicker:"序章 · 200?年",title:"那台掉漆的旧机器",portrait:"assets/father.webp",body:[
    "你爸把厂里淘汰下来的机箱扛回家时，外壳掉了大半的漆。他拿螺丝刀捣鼓了一下午，插上电，风扇转起来的声音像拖拉机。他拍了拍机箱盖：<span class='dialogue'>“能开机，别嫌。”</span>",
    "他不知道那台机器后来做了什么。他只知道那年冬天你写完作业就往那儿坐，坐到他半夜起来上厕所，屏幕还亮着。他在门口站了一会儿，什么也没说，回去睡了。",
    "键盘的 A 键很早就磨没了字。你没换，一直用到进青训营。"]},
  {kicker:"序章 · 童年",title:"她总比对局结束更早等你",portrait:"assets/chen-anan.webp",body:[
    "安安坐在网吧门口的台阶上写作业。你下机的时候天已经黑了，她合上练习册站起来，校服裤子上压出几道折痕。",
    "她从来不提前说会来，但你每次出来都能看见她。有一回你问她等了多久，她说<span class='dialogue'>“没看表，正好写完一张卷子。”</span>",
    "后来你才知道，她每天提前半小时下课，绕半个城区走过来。你问她为什么，她说：<span class='dialogue'>“里面太吵了，怕你出来看见没人。”</span>",
    "（那句话你没有回答。但你后来坐在替补位上的每一场，都会下意识往观众席那边看一眼。）"]},
  {kicker:"第1章 · 14岁",title:"青训名单上的最后一个名字",portrait:"assets/coach-zhou.webp",body:[
    "名单发在战队青训营的公众号推文里，一张手机拍的 A4 纸，反光把中间几行糊掉了。",
    "你从最后一个名字开始看——不是，再往上一个——不是，再往上——直到手指停在倒数第三个位置。你的 ID。入选。",
    "你把手机举得离脸很近，又放下，又举起来看了一遍。宿舍楼下有人在打电话，声音很大，说的是另一件事。",
    "那天晚上你爸没有多说什么，只在饭桌上多放了一双筷子，说<span class='dialogue'>“你妈那份”</span>。"]}
];

const ACHIEVEMENTS=[
  {id:"first_action",icon:"◇",name:"第一次加练",desc:"完成第一次行动"},
  {id:"academy_70",icon:"↗",name:"青训尖子",desc:"16岁前综合能力达到70"},
  {id:"debut",icon:"▣",name:"一队首秀",desc:"完成职业联赛首场比赛"},
  {id:"first_goal",icon:"◎",name:"第一个人头",desc:"职业比赛拿到击杀"},
  {id:"hat_trick",icon:"3",name:"三杀之上",desc:"单场拿到3个及以上关键击杀"},
  {id:"fifty_goals",icon:"50",name:"五十杀",desc:"生涯击杀达到50"},
  {id:"hundred_goals",icon:"100",name:"百杀先生",desc:"生涯击杀达到100"},
  {id:"fifty_assists",icon:"A",name:"团队核心",desc:"生涯助攻达到50"},
  {id:"national",icon:"★",name:"站上国际赛场",desc:"首次入选国际赛事名单"},
  {id:"national_goal",icon:"红",name:"国际赛首杀",desc:"国际赛事拿到击杀"},
  {id:"world_cup",icon:"S",name:"世界之巅",desc:"赢得 S 赛全球总决赛"},
  {id:"asian_cup",icon:"M",name:"季中之王",desc:"赢得 MSI 季中冠军赛"},
  {id:"ballon",icon:"●",name:"年度最佳",desc:"当选年度最佳选手"},
  {id:"league_title",icon:"♛",name:"联赛冠军",desc:"赢得所在联赛冠军"},
  {id:"premier",icon:"K",name:"登陆 LCK",desc:"正式加盟 LCK 战队"},
  {id:"injury_return",icon:"✚",name:"伤愈归来",desc:"手伤停赛后重返赛场"},
  {id:"loyal_love",icon:"♥",name:"长久陪伴",desc:"24岁仍与陈安安相爱"},
  {id:"deep_bond",icon:"❤",name:"心照不宣",desc:"与陈安安关系值达到95"},
  {id:"married",icon:"戒",name:"步入婚姻",desc:"与陈安安结婚"},
  {id:"clean_career",icon:"盾",name:"干净的队服",desc:"完成5个赛季且从未涉赌"},
  {id:"captain_armband",icon:"C",name:"队长",desc:"成为战队队长，拿到 BP 最后一手"},
  {id:"classic_match",icon:"★",name:"名局",desc:"打出一场评分8.5以上、或高风险选择全部命中的比赛"},
  {id:"rival_first_win",icon:"刃",name:"第一次压过江彻",desc:"单赛季击杀数压过宿敌"},
  {id:"rival_streak3",icon:"焰",name:"三年连庄",desc:"连续3个赛季对位压过江彻"},
  {id:"rival_career",icon:"巅",name:"宿敌之上",desc:"生涯对位领先江彻直到退役"}
];

const ACTIONS=[
  {id:"train_solo",style:"carry",phases:["academy","firstteam","overseas","campus","pro"],icon:"◎",name:"单排上分",desc:"一整天泡在排位里。每一把都当决赛打，输了就复盘那三秒自己为什么按错。",effects:["操作↑↑","对线↑","心态↑","精力↓"],max:2,run:s=>{gain(s,"MEC",.75,"mechanics");gain(s,"LAN",.3,"laning");gain(s,"MEN",.22,"mental");change(s,"fitness",-10)}},
  {id:"train_apm",style:"lane",phases:["academy","firstteam","overseas","campus","pro"],icon:"»",name:"手速专项",desc:"补刀训练场、走砍节拍器、极限闪现连招——用手腕的酸换那零点一秒。",effects:["反应↑↑","对线↑","精力↓"],max:2,run:s=>{gain(s,"REA",.8,"reaction");gain(s,"LAN",.4,"laning");change(s,"fitness",-13);fatigueInjuryCheck(s,.022)}},
  {id:"train_gym",style:"macro",phases:["academy","firstteam","overseas","campus","pro"],icon:"▲",name:"体力与作息",desc:"跑步、肩颈拉伸、按点睡觉。没有人因为这个上集锦，但连打三个 BO5 时它就是全部。",effects:["体力↑↑","心态↑","精力↓"],max:2,run:s=>{gain(s,"END",.8,"stamina");gain(s,"MEN",.3,"mental");change(s,"fitness",-13);fatigueInjuryCheck(s,.02)}},
  {id:"train_scrim",style:"call",phases:["academy","firstteam","overseas","campus","pro"],icon:"▣",name:"训练赛磨合",desc:"跟着队伍打排位赛程和内战，赛后把语音一段段倒回去听自己那句话该不该说。",effects:["沟通↑↑","对线↑","教练信任↑","状态↑"],max:2,run:s=>{gain(s,"COM",.8,"comms");gain(s,"LAN",.35,"laning");change(s,"coachFavor",hasTalent(s,"grinder")?5:3);change(s,"form",3);change(s,"fitness",-6);if(hasTalent(s,"grinder")&&chance(.18)){gain(s,"COM",.5);log(s,"good","训练模范发动：你留下加练的那两局被教练看见了。")}}},
  {id:"train_vod",style:"macro",phases:["academy","firstteam","overseas","campus","pro"],icon:"▰",name:"复盘与视野课",desc:"把上一场的录像倒回去，一帧一帧数眼位、数兵线、数那次你本来可以不死。",effects:["意识↑↑","体力↑","教练信任↑","精力↓↓"],max:2,run:s=>{gain(s,"AWA",.8,"macro");gain(s,"END",.3,"stamina");change(s,"coachFavor",2);change(s,"fitness",-14);fatigueInjuryCheck(s,.024)}},
  {id:"love_time",phases:["academy","firstteam","overseas","campus","pro"],icon:"♥",name:"陪安安",desc:"同城就绕远路陪她走一段，异地就隔着屏幕把今天讲给对方听。",effects:["感情↑","状态↑","心态↑","精力↑"],max:1,show:s=>["恋人","暧昧","异地"].includes(s.relationship.status),run:s=>{const away=s.relationship.status==="异地";changeLove(s,hasTalent(s,"childhood_bond")?10:7);change(s,"form",4);change(s,"fitness",4);gain(s,"MEN",.3,"love");if(!away&&chance(.25)){change(s,"coachFavor",-3);log(s,"warn","你晚了七分钟回基地。周骁没有骂你，只在首发表上画了一个圈。")}else if(away)change(s,"coachFavor",-1)}},
  {id:"gift",phases:["firstteam","overseas","pro"],icon:"♡",name:"给安安买礼物",desc:"外出比赛回来带点她念叨过的东西，比一句抱歉管用。",effects:["感情↑↑","状态↑","花钱3万"],max:1,cost:3,show:s=>["恋人","异地","暧昧"].includes(s.relationship.status),run:s=>{addMoney(s,-3);changeLove(s,hasTalent(s,"childhood_bond")?12:9);change(s,"form",4)}},
  {id:"together",phases:["firstteam","overseas","campus","pro"],icon:"❤",name:"和安安独处",desc:"关掉手机，把训练赛和弹幕都留在门外，只有你们两个人。",effects:["状态↑↑","心态↑","精力↓"],max:1,show:s=>s.flags&&s.flags.intimateUnlocked&&["恋人","异地"].includes(s.relationship.status),run:s=>{change(s,"form",12);gain(s,"MEN",.3,"love");change(s,"fitness",-12);changeLove(s,3)}},
  {id:"home",phases:["academy","firstteam","overseas","campus","pro"],icon:"⌂",name:"顾家",desc:"陪父母吃顿饭；手头宽裕就打点钱回去，让父亲少上几天夜班。",effects:["家庭↑","心态↑","状态↑"],max:1,run:s=>{change(s,"family",9);gain(s,"MEN",.28,"mental");change(s,"form",4);if(s.debt)s.debt=Math.max(0,s.debt-2)}},
  {id:"recover",phases:["academy","firstteam","overseas","campus","pro"],icon:"✚",name:"调整作息",desc:"睡到自然醒，加上理疗、手腕康复和睡眠监测——不上热搜，却让你多打两年。",effects:["精力↑↑","状态↑","伤病恢复"],max:2,run:s=>{change(s,"fitness",22+(hasTalent(s,"quick_healer")?6:0));change(s,"form",3);s.injury.risk=Math.max(0,(s.injury.risk||0)-6);if(s.injury.months>0){s.injury.months=Math.max(0,s.injury.months-(hasTalent(s,"quick_healer")?2:1));if(!s.injury.months){s.injury.name="";unlock("injury_return");log(s,"good","复查通过，你重新回到完整训练。")}}}},
  /* 只挂海外线（16→18）。language 最后一次被读是 enterProAt18 的晋升判定，
     18岁之后它只涨不用——继续挂在职业期就是在骗执行点。 */
  {id:"english",phases:["overseas"],icon:"A",name:"认真学韩语",desc:"能听懂指挥是一回事，敢在语音里开口是另一回事。",effects:["语言↑","海外适应↑","心态↑"],max:2,run:s=>{change(s,"language",hasTalent(s,"language_gift")?14:7);gain(s,"MEN",.28,"language");change(s,"form",2)}},
  {id:"street",phases:["academy","campus"],icon:"✦",name:"网吧五黑",desc:"没有战术板，只有五个人挤在一排机器前，输了就骂，赢了就笑。",effects:["对线↑↑","沟通↑","作息/纪律风险"],max:1,run:s=>{gain(s,"LAN",1,"laning");gain(s,"COM",.35,"comms");change(s,"coachFavor",-3);change(s,"fitness",-11);fatigueInjuryCheck(s,.032)}},
  {id:"campus_match",phases:["campus"],icon:"旗",name:"高校赛事",desc:"职业通道变窄了，但服务器没有关。",effects:["操作↑","对线↑","人气↑"],max:2,run:s=>{gain(s,"MEC",.55,"mechanics");gain(s,"LAN",.45,"laning");change(s,"fame",5);change(s,"fitness",-12)}},
  {id:"media",phases:["firstteam","overseas","pro"],icon:"●",name:"直播与采访",desc:"开播能涨粉，但说出去的每句话都会被切片。",effects:["人气↑","金钱↑","专注可能↓"],max:1,run:s=>{change(s,"fame",5);addMoney(s,3+Math.floor(s.fame/20));change(s,"form",chance(.35)?-3:1)}},
  {id:"coach_talk",phases:["firstteam","overseas","pro"],icon:"□",name:"找教练谈首发",desc:"问清楚自己为什么被换下来，以及那个答案是否可信。",effects:["教练信任↑/↓","首发概率↑","心态↑"],max:1,run:s=>{const ok=chance(.48+s.attrs.MEN/220+(hasTalent(s,"shotcaller")?.1:0));change(s,"coachFavor",ok?8:-3);gain(s,"MEN",.25,"pressure");log(s,ok?"good":"warn",ok?"你带着数据和录像去谈，教练给出了具体要求。":"教练认为你在用谈话绕过训练赛里的竞争。")}},
  {id:"national_role",phases:["pro"],icon:"★",name:"练备用英雄池",desc:"为国际赛准备版本冷门与备用位置，队内训练会被分走。",effects:["国际赛适配↑","沟通↑","状态↓"],max:1,show:s=>s.national.called,run:s=>{change(s.national,"adapt",9);gain(s,"COM",.4,"draft");change(s,"form",-2)}}
];

// 行动组合：同一个月里凑齐指定行动会额外触发一次，每月每种只触发一次。
// all=全部要有，any=至少有一个，cond=额外条件。
const COMBOS=[
  {id:"sci_train",name:"科学训练",any:["train_apm","train_vod"],all:["recover"],
   text:"手速课刚下就进了理疗室，冰敷、拉伸、睡眠监测一样没落。手腕还没来得及把这天记住。",
   run:s=>{s.injury.risk=Math.max(0,(s.injury.risk||0)-8);change(s,"fitness",5)}},
  {id:"goal_study",name:"回放研究",all:["train_solo","train_scrim"],
   text:"单排打完再把训练赛录像倒回去看，慢放到第三遍你才发现——问题不在手上，在开团前那两秒的位置。",
   run:s=>{addStyleExp(s,"carry",8);addStyleExp(s,"call",8)}},
  {id:"life_balance",name:"生活平衡",any:["train_solo","train_apm","train_gym","train_scrim","train_vod"],all:["love_time"],
   text:"训练和她之间不必二选一。这个月你把两头都顾上了，坐到位置上的时候心是稳的。",
   run:s=>{change(s,"form",4);changeLove(s,4)}},
  {id:"star_effect",name:"流量效应",all:["media"],cond:s=>s.matches[0]&&s.matches[0].rating>=7.5,
   text:"上一场的高光切片还挂在热搜上，这次开播的分量翻了一倍。",
   run:s=>{change(s,"fame",5)}}
];
// 流派：天赋是出生特质，流派是后天打法。两者独立累积，互不排斥。
const STYLES=[
  {key:"carry",name:"大核",icon:"◎",desc:"抬高操作的成长上限",attrs:["MEC"],
   levels:["操作类关键时刻成功率 +5%","解锁比赛选项「强杀」","逆风局的翻盘机会成功率再 +8%，击杀评分更高"]},
  {key:"lane",name:"压制",icon:"»",desc:"抬高反应与对线的成长上限",attrs:["REA","LAN"],
   levels:["单杀与越塔场景成功率 +6%","解锁比赛选项「压线换血」","对线成功后额外 12% 概率直接滚成雪球"]},
  {key:"macro",name:"运营",icon:"▲",desc:"抬高意识与体力的成长上限",attrs:["AWA","END"],
   levels:["视野与抢龙场景出现率提高","解锁比赛选项「布控视野」","运营选项成功后必定为队友创造机会"]},
  {key:"call",name:"指挥",icon:"▣",desc:"抬高沟通的成长上限",attrs:["COM"],
   levels:["助攻转化率 +8%","解锁比赛选项「开团指令」","全队整体实力 +2"]}
];
const STYLE_NUMERALS=["Ⅰ","Ⅱ","Ⅲ"];
function styleLevel(exp){return exp>=120?3:exp>=60?2:exp>=20?1:0}
function styleOf(s,key){return styleLevel((s.styles&&s.styles[key])||0)}
function styleNext(exp){return exp>=120?120:exp>=60?120:exp>=20?60:20}
function addStyleExp(s,key,n){
  if(!s.styles)s.styles={carry:0,lane:0,macro:0,call:0};
  if(!(key in s.styles))return;
  const before=styleLevel(s.styles[key]);
  s.styles[key]=Math.max(0,s.styles[key]+n);
  const after=styleLevel(s.styles[key]);
  if(after>before){const st=STYLES.find(x=>x.key===key);
    log(s,"good",`流派进阶：${st.name} ${STYLE_NUMERALS[after-1]}级——${st.levels[after-1]}。`);
    toast(`${st.name} 升到 ${STYLE_NUMERALS[after-1]} 级`)}
}
function topStyle(s){const st=s.styles||{};const k=Object.keys(st).sort((a,b)=>(st[b]||0)-(st[a]||0))[0];return k&&st[k]>0?k:null}

function checkCombos(s){
  if(!Array.isArray(s.combosHit))s.combosHit=[];
  const has=id=>(s.actionUsage[id]||0)>0;
  COMBOS.forEach(c=>{
    if(s.combosHit.includes(c.id))return;
    if(c.all&&!c.all.every(has))return;
    if(c.any&&!c.any.some(has))return;
    if(c.cond&&!c.cond(s))return;
    s.combosHit.push(c.id);c.run(s);
    log(s,"good",`行动组合「${c.name}」：${c.text}`);
    toast(`行动组合：${c.name}`);
  });
}

function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,n))}
function rand(min,max){return Math.floor(Math.random()*(max-min+1))+min}
function pick(a){return a[Math.floor(Math.random()*a.length)]}
function chance(p){return Math.random()<p}
/* 图片路径的唯一出口。
   单文件版的打包脚本靠「带引号的 assets 路径」这个特征，把 app.js 里的路径
   字面量换成内联的 data URI。可 HTML 属性也带引号——模板串里直接把路径写进
   img 的 src 属性，会被同一条正则改成一段 JS 表达式，原样进 DOM 就是一张裂图。
   （故事页那张 76x96 的关系卡就这么裂了一路，从原作继承下来的。）
   所以模板里一律写成 ${asset(路径)}，让替换发生在 JS 表达式里而不是属性里。
   build_single.py 有一条自检专门守这个。 */
function asset(p){return p}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function hasTalent(s,id){return s.talents.includes(id)}
function talentById(id){return TALENTS.find(t=>t.id===id)}
function change(obj,key,n){obj[key]=clamp((obj[key]??0)+n);return obj[key]}
function changeLove(s,n){if(["分手","反目"].includes(s.relationship.status))return s.relationship.love;const mult=hasTalent(s,"childhood_bond")&&n>0?1.25:1;s.relationship.love=clamp(s.relationship.love+n*mult);return s.relationship.love}
function trainMult(s){return 1+assetTrain(s)}
function gain(s,key,n,tag){
  if(!(key in s.attrs)){console.warn("gain: 未知属性",key);return}
  const d=diffOf(s);let mult=1;
  // 天赋只放大正收益：放在 if(n>0) 之外会让「训练模范」把扣分也加重。
  if(n>0){
    if(hasTalent(s,"explosive_start")&&(key==="REA"||key==="LAN"))mult+=.25;
    if(hasTalent(s,"engine")&&key==="END")mult+=.25;
    if(hasTalent(s,"aerial_king")&&key==="END")mult+=.2;
    if(hasTalent(s,"big_heart")&&key==="MEN")mult+=.18;
    if(hasTalent(s,"football_iq")&&(key==="COM"||tag==="tactics"))mult+=.25;
    if(hasTalent(s,"free_kick")&&key==="COM")mult+=.3;
    if(hasTalent(s,"box_instinct")&&key==="MEC")mult+=.14;
    if(hasTalent(s,"ambidextrous")&&(key==="MEC"||key==="LAN"))mult+=.12;
    if(tag&&hasTalent(s,"training_rat")&&chance(.08))mult+=.5;
    mult*=d.growth*softFactor(s.attrs[key],d,styleCapLevel(s,key))*trainMult(s)*actionMult;
    if(key==="MEC"&&s.flags&&s.flags.outOfPosition)mult*=.7;
  }
  s.attrs[key]=clamp(s.attrs[key]+n*mult,1,99);
}
/* 流派等级抬高对应属性的成长软上限，每级 +5。MEN 不归任何流派——
   它只从剧情选择、压力事件和安安那里长，练不出来。 */
function styleCapLevel(s,key){
  if(!s||!s.styles)return 0;
  let lv=0;
  for(const st of STYLES)if(st.attrs&&st.attrs.includes(key))lv=Math.max(lv,styleOf(s,st.key));
  return lv;
}
/* 权重取自分路表，不再是 ATTRS 上那一份固定的 w——同一套属性放在辅助
   和中单身上值的钱完全不同，这是分路唯一介入数值的地方。
   ATTRS[].w 只在没有分路（老存档、单元测试）时兜底。 */
function overall(s){return Math.round(ATTRS.reduce((t,a)=>t+s.attrs[a.key]*attrW(s,a.key),0))}
/* 卡面 OVR 读裸值；教练选人读 effOverall——同一张权重表，但经 eff() 一次，
   于是状态与精力经内核影响首发，而不是再掺一个 form 散项。 */
function effOverall(s){return ATTRS.reduce((t,a)=>t+eff(s,a.key)*attrW(s,a.key),0)}
function ageInfo(s){return{age:14+Math.floor(s.totalMonth/12),month:s.totalMonth%12+1,season:Math.floor(s.totalMonth/12)+1}}
function phaseOf(s){const a=ageInfo(s).age;if(a<16)return"academy";if(a<18)return s.route||"academy";return"pro"}
function currentClub(s){const base=[...LPL_TEAMS,...LCK_TEAMS].find(c=>c.name===s.club.name);return base?{...base,...s.club}:{...s.club}}
function log(s,kind,text){s.log.unshift({id:`l${Date.now()}${Math.random()}`,month:s.totalMonth,kind,text});s.log=s.log.slice(0,80)}
function fixtureLabel(s){const a=ageInfo(s);return`${a.age}岁 · 第${a.month}月`}

function createInitialState(name="Zephyr",allocation=START_ALLOC,talents=[],difficulty="standard",originTier="normal",position="mid"){
  const attrs={};ATTRS.forEach(x=>attrs[x.key]=clamp(42+(allocation[x.key]||0)*4,1,99));
  const tier=Object.hasOwn(ORIGIN_TIERS,originTier)?originTier:"normal";
  Object.entries(ORIGIN_TIERS[tier].adj).forEach(([k,v])=>attrs[k]=clamp(attrs[k]+v,1,99));
  const pos=POSITIONS.some(p=>p.key===position)?position:"mid";
  const state={version:VERSION,runId:`r${Date.now()}${Math.random().toString(36).slice(2,7)}`,name:name.trim()||"Zephyr",position:pos,totalMonth:0,actionPoints:3,allocation:{...allocation},originTier:tier,talents:[...talents],attrs,fitness:90,form:60,coachFavor:50,family:86,language:8,fame:3,money:0,salary:0,debt:0,assets:{house:false,gym:false,coach:false},difficulty:DIFFICULTIES[difficulty]?difficulty:"standard",seasonGoal:null,challenge:null,matchPlan:"carry",styles:{carry:0,lane:0,macro:0,call:0},pendingMatch:null,combosHit:[],retired:false,peakOverall:0,route:"academy",club:{name:"CQG 青训队",league:"LDL",strength:58},relationship:{name:"陈安安",status:"恋人",love:80,conflictShield:hasTalent({talents},"childhood_bond")?1:0},injury:{name:"",months:0,risk:0},risks:{gambling:0},flags:{route16:false,pro18:false,overseasBreakup:false,hivDiagnosed:false,bettingEver:false,captain:false,father_alive:true},statsCareer:{matches:0,starts:0,goals:0,assists:0,wins:0,draws:0,losses:0,nationalCaps:0,nationalGoals:0,bestRating:0,hatTricks:0},seasonStats:{matches:0,goals:0,assists:0,wins:0,ratingTotal:0,trophies:0},national:{called:false,adapt:0,caps:0,goals:0,worldCups:0,asianCups:0},honours:[],awards:[],transfers:[],offers:[],matches:[],usedEvents:[],recentEvents:[],actionUsage:{},log:[],tab:"actions",lastSeasonAward:null};
  log(state,"story","你进入 CQG 青训队。父亲把你送到基地门口就走了，安安把一瓶水塞进你包里。");
  return state;
}

function fatigueInjuryCheck(s,base){const p=Math.max(0,(base*actionInjuryMult+(50-s.fitness)/500+(s.injury.risk||0)/800-(hasTalent(s,"iron_man")?.025:0))*diffOf(s).injury*assetInjuryFactor(s));if(chance(p))sufferInjury(s,p>.1?2:1)}
function sufferInjury(s,months=1){const list=["腱鞘炎复发","手腕劳损","颈椎压迫","长期失眠","心态崩盘"];s.injury.name=pick(list);s.injury.months=Math.max(s.injury.months,Math.max(1,months-(hasTalent(s,"quick_healer")?1:0)));if(s.injury.months>=3)s.flags.serious_injury=true;change(s,"form",-7);log(s,"bad",`${s.injury.name}，预计伤停${s.injury.months}个月。`);enqueueDecision({title:"你受伤了",body:`<p class="dialogue">${s.injury.name}，预计伤停 ${s.injury.months} 个月。</p><p>这段时间不能高强度训练和上场，只能做调整作息、顾家、陪安安这类行动。</p>`,options:[option("知道了","",()=>{})]},"伤病")}

function addMoney(s,n){s.money=Math.round((s.money||0)+n)}
const ASSETS=[
  {id:"home_gym",cat:"训练",icon:"▰",name:"自己的训练房",cost:60,desc:"两台顶配主机、一块 360Hz 屏、一把合手的椅子。回家还能再练两小时。",effect:"训练成长 +8%",train:.08,buy:s=>change(s,"fitness",6)},
  {id:"coach",cat:"训练",icon:"□",name:"私人指导",cost:130,desc:"请一个退役的老选手一对一陪练，专挑你不敢碰的英雄和不敢打的团。",effect:"训练成长 +10% · 教练信任+",train:.10,buy:s=>change(s,"coachFavor",6)},
  {id:"nutritionist",cat:"训练",icon:"◍",name:"作息与营养管理",cost:100,desc:"有人管你几点睡、吃什么、什么时候必须离开电脑。听起来最没用，最后活得最久的都是买了这个的人。",effect:"训练成长 +5% · 精力+",train:.05,buy:s=>change(s,"fitness",8)},
  {id:"analyst",cat:"训练",icon:"◇",name:"私人数据分析",cost:120,desc:"有人替你把每一局的视野覆盖、兵线处理和团战站位拆成表格。你终于知道自己错在哪一秒。",effect:"训练成长 +6% · 沟通+",train:.06,buy:s=>gain(s,"COM",2,"vision")},
  {id:"rehab",cat:"训练",icon:"✚",name:"手部康复团队",cost:200,desc:"手腕理疗、颈椎牵引、肌腱评估全包。这一行真正让人退役的不是打不动，是手废了。",effect:"手伤概率大幅下降",injuryCut:.55,minAge:19,buy:s=>{change(s,"fitness",10);s.injury.risk=Math.max(0,(s.injury.risk||0)-15)}},
  {id:"science",cat:"训练",icon:"⚛",name:"电竞科研支持",cost:450,desc:"反应测试、眼动追踪、睡眠实验室，一整个团队只围着你一个人转，把巅峰期往后拖。",effect:"训练成长 +12% · 手伤再降",train:.12,injuryCut:.75,minAge:22,req:s=>ownedAsset(s,"rehab"),reqText:"需先有私人康复团队",buy:s=>{}},
  {id:"parents_rent",cat:"家庭",icon:"⌂",name:"给父母租套好房",cost:45,desc:"先让爸妈从老破小里搬出来。",effect:"家庭+ · 状态+4",buy:s=>{change(s,"family",12);change(s,"form",4)}},
  {id:"parents_house",cat:"家庭",icon:"⏠",name:"给父母买房",cost:300,desc:"让父亲彻底告别夜班，母亲有个像样的家。",effect:"家庭大幅提升 · 状态+7",req:s=>ownedAsset(s,"parents_rent"),reqText:"需先给父母租房",buy:s=>{change(s,"family",22);change(s,"form",7)}},
  {id:"parents_villa",cat:"家庭",icon:"⏦",name:"给父母买大宅",cost:800,desc:"把你能给的最好生活，摆到爸妈面前。",effect:"家庭拉满 · 人气+ · 状态+6",req:s=>ownedAsset(s,"parents_house"),reqText:"需先给父母买房",buy:s=>{change(s,"family",30);change(s,"fame",6);change(s,"form",6)}},
  {id:"car",cat:"生活",icon:"⛟",name:"买一辆车",cost:150,desc:"再也不用等基地的班车，也不用凌晨三点打车回家。",effect:"人气+ · 状态+4",buy:s=>{change(s,"fame",5);change(s,"form",4)}},
  {id:"apartment",cat:"生活",icon:"❒",name:"自己的公寓",cost:400,desc:"基地之外，终于有个不用跟五个人挤在一层楼的地方。",effect:"状态+6 · 净资产+",buy:s=>change(s,"form",6)},
  {id:"luxury_car",cat:"生活",icon:"◈",name:"梦想中的豪车",cost:600,desc:"停在基地门口，路过的粉丝都会拍一张。",effect:"人气++",req:s=>ownedAsset(s,"car"),reqText:"需先买一辆车",minFame:45,buy:s=>change(s,"fame",12)},
  {id:"mansion",cat:"生活",icon:"⏢",name:"城郊豪宅",cost:1600,desc:"影音室、开黑房、一整面墙的奖杯柜，你为自己造了一座城堡。",effect:"人气+++ · 状态+7",req:s=>ownedAsset(s,"apartment"),reqText:"需先有自己的公寓",minFame:60,buy:s=>{change(s,"fame",18);change(s,"form",7)}},
  {id:"image_team",cat:"生活",icon:"◐",name:"形象与公关团队",cost:220,desc:"专人替你经营公众形象，把该说的话说到位。",effect:"每月人气增长 · 人气+14",minFame:40,buy:s=>{change(s,"fame",14)}},
  {id:"restaurant",cat:"投资",icon:"◔",name:"投资一家餐厅",cost:250,desc:"电竞选手退役得早。给二十六岁之后的自己留一条稳定的进账。",effect:"每月被动收入 +6万",passive:6,buy:s=>{}},
  {id:"brand",cat:"投资",icon:"◉",name:"创立个人品牌",cost:650,desc:"把名气变成能持续赚钱的生意。",effect:"每月被动收入 +12万 · 人气+",passive:12,minFame:60,buy:s=>change(s,"fame",8)},
  {id:"academy",cat:"投资",icon:"♟",name:"创办青训营",cost:1200,desc:"把你走过的路，留给下一批在网吧里熬夜的孩子。",effect:"每月被动收入 +20万 · 人气+",passive:20,minAge:24,minFame:55,buy:s=>change(s,"fame",12)},
  {id:"ring",cat:"感情",icon:"◇",name:"给安安买戒指",cost:80,desc:"你想好了，这一次不再让她一个人等。",effect:"感情+ · 状态+6 · 解锁婚礼",minAge:20,req:s=>["恋人","异地"].includes(s.relationship.status)&&s.relationship.love>=85,reqText:"需恋爱中且好感≥85",buy:s=>{changeLove(s,8);change(s,"form",6);s.flags.engaged=true}},
  {id:"wedding",cat:"感情",icon:"♥",name:"和安安办婚礼",cost:350,desc:"父亲把你交到她手里，只说了句“照顾好她”。",effect:"感情拉满 · 家庭+ · 状态+11 · 成就",req:s=>s.flags&&s.flags.engaged&&s.relationship.love>=85,reqText:"需先求婚",buy:s=>{changeLove(s,12);change(s,"family",15);change(s,"form",11);s.flags.married=true;unlock("married")}}
];
const ASSET_CATS=["训练","家庭","生活","投资","感情"];
function ownedAsset(s,id){return !!(s.assets&&s.assets[id])}
function assetTrain(s){let t=0;ASSETS.forEach(a=>{if(a.train&&ownedAsset(s,a.id))t+=a.train});return Math.min(.45,t)}
function assetPassive(s){let p=0;ASSETS.forEach(a=>{if(a.passive&&ownedAsset(s,a.id))p+=a.passive});return p}
function assetInjuryFactor(s){let f=1;ASSETS.forEach(a=>{if(a.injuryCut&&ownedAsset(s,a.id))f*=a.injuryCut});return f}
function assetValue(s){let v=0;ASSETS.forEach(a=>{if(ownedAsset(s,a.id))v+=a.cost});return v}
function assetLocked(s,a){if(a.minAge&&ageInfo(s).age<a.minAge)return`需${a.minAge}岁`;if(a.minFame&&s.fame<a.minFame)return`需人气${a.minFame}`;if(a.req&&!a.req(s))return a.reqText||"未满足前置条件";return null}
function buyAsset(s,id){const it=ASSETS.find(x=>x.id===id);if(!it||ownedAsset(s,id))return false;if(assetLocked(s,it))return false;if((s.money||0)<it.cost)return false;addMoney(s,-it.cost);s.assets=s.assets||{};s.assets[id]=true;it.buy&&it.buy(s);log(s,"good",`你花 ${it.cost} 万拿下了「${it.name}」。`);return true}
function option(text,effect,apply,tone=""){return{text,effect,apply,tone}}

const EVENTS=[
  /* ===== 宿敌：江彻 ===== 每个阶段两三条，给对位之争铺情绪。只给小额状态/心态，不给属性大数。 */
  {id:"rival_first_sight",once:true,phase:["academy"],condition:s=>!!s.rival,title:"熄灯后，训练室里还有一个人",body:"<p>你回宿舍拿落下的充电线，路过训练室，发现灯还亮着一半。江彻一个人在训练室里，同一个连招，同一个走位，做完再重置，再来一次。</p><p>你站在暗处看了一会儿。他每一次按键的声音都很干净，像有人在敲同一个琴键。教练白天说他是<span class='dialogue'>“十年一遇”</span>，说这话的时候你就站在旁边。</p><p>他忽然停下来，没回头：<span class='dialogue'>“看够了没？看够了过来陪我打两把。”</span></p>",options:s=>[
    option("留下来陪他练到熄灯","心态+1，精力-8；他记住了你",()=>{gain(s,"MEN",1,"will");change(s,"fitness",-8);log(s,"story","你陪他打了四十分钟单挑，输了七把。走的时候他说：“明天还是这个点。”你们谁都没把这当成邀请，但第二天你们都在。")}),
    option("转身回宿舍","精力+5；有些账留到赛场上算",()=>{change(s,"fitness",5);log(s,"story","你走的时候他没再说话。第二天训练赛，他把一个本可以自己拿的人头让给了你。你们谁也没提昨晚。")})]},
  {id:"rival_praise",once:true,phase:["academy"],condition:s=>!!s.rival,title:"教练夸你努力的时候，夸的是他的天赋",body:"<p>训练赛结束，周骁把全队叫到复盘室。他先点了江彻的名字：<span class='dialogue'>“那一下反应，我教不出来。”</span>然后他看了你一眼：<span class='dialogue'>“Zephyr今天跑了全场最多的距离。”</span></p><p>没有人笑，但你听得懂这两句话的区别。一句在说天花板，一句在说地板。</p><p>解散后江彻从你身边走过，用只有你能听见的音量说：<span class='dialogue'>“跑动距离，嗯。”</span>他没有恶意，这更糟。</p>",portrait:"assets/coach-zhou.webp",options:s=>[
    option("把这句话咽下去，加练操作","操作经验+，状态-3；话放在心里比说出来重",()=>{addStyleExp(s,"carry",6);change(s,"form",-3)}),
    option("当面回他：赛场上见","心态+1；从今天起你们是对手了",()=>{gain(s,"MEN",1,"pressure");log(s,"story","他愣了一下，然后笑了。那是他第一次正眼看你超过三秒。“好。”他说，“赛场上见。”")})]},
  {id:"rival_paths",once:true,phase:["firstteam","overseas","campus"],condition:s=>!!(s.rival&&s.rival.route),title:"他走了那条你没走的路",body:"<p>消息是队友先刷到的，转给你的时候配了三个感叹号。官方通稿，江彻的名字在标题里。</p><p>你点开看完，配图是他拖着行李箱回头的那张。拍得很好，光从背后打过来，他看起来已经像那种「注定要走远」的人。</p><p>你想起熄灯后的赛场，想起他说<span class='dialogue'>“赛场上见”</span>。现在你们隔着的不止是一块场地了。</p><p>晚上他给你发来一条消息，没有开头没有落款：<span class='dialogue'>“别掉队。”</span></p>",options:s=>[
    option("回他：你也是","心态+1；这条线牵到职业赛场上去了",()=>{gain(s,"MEN",1,"will")}),
    option("不回，把消息设为置顶","状态+3；有些话适合留着当燃料",()=>{change(s,"form",3)})]},
  {id:"rival_interview",phase:["pro"],weight:.8,condition:s=>!!(s.rival&&s.rival.club&&s.totalMonth>=50),title:"发布会上，第三个问题是关于他的",body:"<p>前两个问题都是套路，第三个问题来了：<span class='dialogue'>“江彻这个赛季击杀比你多（或者比你少——记者会挑对他有利的那个说法），你怎么看你们俩的比较？”</span></p><p>话筒递到你面前。摄像机的红点都亮着。你知道不管你说什么，明天的标题都已经写好了一半。</p>",options:s=>[
    option("回一句硬的","人气+6，状态±；标题会很好看，休息室未必",()=>{change(s,"fame",6);change(s,"form",chance(.55)?4:-4);log(s,"story","你说：“比较是你们的工作，击杀是我的。”说完你自己都觉得这句会被做成动图。果然。")}),
    option("只谈战队，不接这个茬","教练信任+4，心态+1；记者失望，教练满意",()=>{change(s,"coachFavor",4);gain(s,"MEN",1,"pressure")})]},
  {id:"rival_lowpoint",once:true,phase:["pro"],condition:s=>!!(s.rival&&s.rival.duels&&s.rival.duels.loss>=2),title:"连续两年，他的名字都压在你前面",body:"<p>赛季数据汇总的推送是自动的，没有感情：江彻，又一次排在你前面。评论区已经开始用<span class='dialogue'>“一生之敌”</span>造句，只是主角不是你。</p><p>你把手机扣在桌上。窗外天还没黑，训练室的灯已经亮了。你想起十四岁那年熄灯后的赛场，那时候留在场上加练的人是他，站在暗处看的人是你。</p><p>十年过去，好像什么都变了，又好像什么都没变。</p>",options:s=>[
    option("今晚去把灯全打开","加练：操作经验+，精力-10；轮到他看不见你的背影了",()=>{addStyleExp(s,"carry",8);change(s,"fitness",-10);gain(s,"MEN",1,"will")}),
    option("找安安说说这件事","感情+6，状态+4；不是所有账都要一个人扛",()=>{changeLove(s,6);change(s,"form",4)})]},
  {id:"rival_respect",once:true,phase:["pro"],condition:s=>!!(s.rival&&s.rival.duels&&s.rival.duels.win>=3),title:"凌晨一点，他发来一条消息",body:"<p>不是节日，不是你生日，也不是比赛日。就是一个普通的凌晨，手机亮了一下。</p><p>江彻：<span class='dialogue'>“看了你这赛季所有的高光。第七个那种操作，我做不出来。”</span></p><p>你盯着这条消息看了很久。十几年了，你们在记分牌上互相较劲，在采访里互相不接茬，可你比谁都清楚——没有他在前面吊着，你到不了现在这个位置。</p><p>过了一会儿，他又发来一条：<span class='dialogue'>“下赛季我会变强。”</span></p>",options:s=>[
    option("回：我等着","心态+1，状态+4；最好的对手就是这样的",()=>{gain(s,"MEN",1,"will");change(s,"form",4);log(s,"good","你放下手机，忽然很想笑。十四岁那年他说“赛场上见”，这句话你们各自兑现了十年。")}),
    option("不回，明天加练","操作经验+；话不用多，打给他看",()=>{addStyleExp(s,"carry",6)})]},
  {id:"academy_ankle",once:true,phase:["academy"],title:"队医说“可以上”，你的手腕说不行",body:"<p>队医捏着你手腕按了两下，问了三个问题：疼不疼、能不能发力、连招卡不卡。你回了三个“不”。他点点头，在报告上写“可参赛”。</p><p>周骁在你旁边翻名单，头没抬：<span class='dialogue'>“首发名单只等你一句话。”</span></p><p>你活动了一下手腕，转到某个角度时里面有一根筋像被拨了一下，不尖锐，但你知道它在。</p><p>安安发来一条消息：<span class='dialogue'>“膝盖以下的部分还连着吗？”</span>你没回。你把护踝拉紧了两格，走进通道。</p>",portrait:"assets/coach-zhou.webp",options:s=>[
    option("咬牙首发","人气+8；可能抓住机会，也可能伤停2—4个月",()=>{change(s,"fame",8);change(s,"coachFavor",4);if(chance(hasTalent(s,"iron_man")?.28:.48))sufferInjury(s,rand(2,4));else{change(s,"form",6);log(s,"good","你撑过了比赛，但这不是一个可以反复使用的答案。")}},"danger"),
    option("主动退出名单","精力+12；教练信任-5，心态+1",()=>{change(s,"fitness",12);change(s,"coachFavor",-5);gain(s,"MEN",1,"will")})]},
  {id:"xiaoman_exam",once:true,phase:["academy"],title:"她的考试，和你的选拔赛在同一天",body:"<p>安安把准考证放在你桌上，什么也没说。你拿起来看了一眼——考试时间下午两点，你的选拔赛两点半开赛。</p><p>她已经在门口穿外套了，背对着你说：<span class='dialogue'>“不用送，我坐公交。”</span></p><p>你捏着那张纸，纸张边缘被她的手指攥出了细小的折痕。你想起初中那次你发烧，她在校医室陪了你一下午，自己错过了模考。</p><p>她直起腰，拉开门，回头看了你一眼。那一眼很短，没有期待，没有暗示，只是确认你还在。然后她笑了一下：<span class='dialogue'>“赢了再跟我说。”</span></p><p>门关上了。你低头看那张准考证，才发现背面用铅笔写了一行很小的字：<span class='dialogue'>“别迟到就好——你的比赛。”</span></p>",portrait:"assets/chen-anan.webp",options:s=>[
    option("送她去考场再赶比赛","感情+10；精力-10，比赛状态存在波动",()=>{changeLove(s,10);change(s,"fitness",-10);change(s,"form",chance(.5)?3:-4);log(s,"story","你在考场门口转身跑向公交站时，听见她在背后喊了一句“跑慢点！”你回头，她已经进去了，隔着玻璃朝你摆手。")}),
    option("提前去赛场热手","人气+9，状态+5；感情-10",()=>{change(s,"fame",9);change(s,"form",5);changeLove(s,-10);log(s,"story","比赛前你收到一条短信，只有两个字：“写完了。”你没回，把手机锁进柜子。")})]},
  {id:"father_boots",once:true,phase:["academy"],title:"父亲买了一把你不敢用坏的键盘",body:"<p>手提袋放在你床上，不是快递箱，是店里的袋子。你打开，一把红轴机械键盘——你上个月在店里隔着玻璃摸过的那把。键帽下面还垫着旧报纸，你爸的习惯。</p><p>你走出房间，他坐在客厅里修遥控器，头没抬：<span class='dialogue'>“旧的那个我扔了。字都磨没了，按着容易出错。”</span></p><p>你没有拆穿——那把旧键盘你上周自己收起来了，根本没给他看见过。他一定是翻了你的柜子。</p><p>你把新键盘放回袋子，又把旧的从柜子里翻出来：A 键的字早就没了，空格键中间磨出一道亮痕，是你打了三年排位磨出来的。你没有换新的，但你把袋子放在床头，放了很久。</p>",portrait:"assets/father.webp",options:s=>[
    option("收下新键盘，把旧的留作纪念","反应+1，家庭+5；父亲继续加班",()=>{gain(s,"REA",1,"lane");change(s,"family",5);s.risks.familyFatigue=(s.risks.familyFatigue||0)+7}),
    option("去退掉，换一把便宜的","家庭+8，心态+1；本月训练状态-3",()=>{change(s,"family",8);gain(s,"MEN",1,"will");change(s,"form",-3)})]},
  {id:"teammate_blame",phase:["academy","firstteam","overseas"],title:"队友把这波团灭算在你头上",body:"<p>训练赛最后一波，你在对面野区被抓，团灭，水晶爆了。</p><p>休息室里没人说话。只有饮水机的声音，和有人推椅子的声音。直到有人——不是最大声的那个，但也不是最小声的——从柜子那头丢过来一句：<span class='dialogue'>“有些人，集锦够用了，比赛够呛。”</span></p><p>所有人都听见了。有人低头看手机，有人假装在收键盘。你站在自己位置前面，背对着所有人，能感觉到背后的视线。你在等他再说一句。</p><p>他没有说。他等你说。</p>",portrait:"assets/coach-zhou.webp",options:s=>[
    option("当场顶回去","心态+1，队内地位可能上升；教练信任波动",()=>{gain(s,"MEN",1,"pressure");change(s,"coachFavor",chance(.5)?5:-5);log(s,"story","你转过身。没等你开口，队长先站起来挡在你面前：“打不赢是全队的事，有话说清楚。”休息室安静了三秒，有人把柜门关上了。")}),
    option("承认失误，要求一起复盘","沟通+1，教练信任+5；状态-3",()=>{gain(s,"COM",1,"vision");change(s,"coachFavor",5);change(s,"form",-3);log(s,"story","你说：“那波是我的锅。但我想全队一起看录像，他们那次反打是怎么滚起来的。”靠窗的队友把手机放下了。")})]},
  {id:"mystery_supplement",phase:["academy","firstteam","overseas","pro"],title:"一瓶“绝对查不出来”的补剂",body:"<p>训练结束后，一个平时不怎么跟你说话的人从包里拿出一瓶东西，放在你凳子上。没有完整中文标签，瓶身是哑光白，上面只有一行英文，没写成分。</p><p>他说：<span class='dialogue'>“精力师配的，恢复快，绝对查不出来。”</span>你问他多少钱。他说不用钱，<span class='dialogue'>“你先试，有用再说。”</span></p><p>他走之后你拿起那瓶东西晃了一下，液体，没有味道。瓶口封膜完好，但封膜下面的压印不太平整。</p><p>队医办公室的门还亮着。走廊里没有人。你把这瓶东西放进了柜子，没有扔，也没有用。</p>",options:s=>[
    option("拒绝并报告队医","教练信任+4，队友关系受损；伤病风险-8",()=>{change(s,"coachFavor",4);s.injury.risk=clamp((s.injury.risk||0)-8);log(s,"good","队医把补剂封存了。你没走捷径，也没把前途交到一个陌生人手里。")}),
    option("只拿去检测，不供出队友","花费4万；心态+1，教练无变化",()=>{addMoney(s,-4);gain(s,"MEN",1,"will");s.injury.risk=clamp((s.injury.risk||0)-4)})]},
  {id:"viral_clip",once:true,phase:["academy","campus"],title:"十秒操作视频突然有了二十万播放",body:"<p>你是在训练结束后刷到的。不知道谁拍的，镜头晃了一下，只截了你那次一挑三反杀的十秒，前面三次送头全部剪掉了。</p><p>评论区有人说“LPL 有救了”，有人说“切片选手”，有人在吵你的动作像谁。经纪人私信进来了，措辞很专业：<span class='dialogue'>“你好，我是某经纪公司，是否有意向聊一下职业规划？”</span></p><p>周骁也发来一条消息，没有链接，只有一句话：<span class='dialogue'>“谁允许训练的时候拍的？”</span></p><p>你放下手机。那十秒还在自动循环播放。你盯着屏幕上那个反杀的自己，觉得有点陌生——那个动作你做出来的时候根本没想那么多。</p>",options:s=>[
    option("顺势经营个人账号","人气+10；话题会跟着你",()=>{change(s,"fame",10)}),
    option("删除视频并向战队说明","教练信任+8；错过曝光，心态+1",()=>{change(s,"coachFavor",8);gain(s,"MEN",1,"pressure")})]},
  {id:"growth_pain",once:true,phase:["academy"],title:"一次版本大改，你的英雄池废了一半",body:"<p>更新公告出来那天，你在训练室里把补丁说明看了三遍。你最拿手的那三个英雄，一个被砍了核心机制，两个直接退出版本。</p><p>教练把你的英雄池划掉了一半。版本更新之后，你的肌肉记忆还留在上个版本——手已经按出了那个连招，但技能的范围已经改了。</p><p>教练在笔记上写了两行，训练结束后把你叫到一边：<span class='dialogue'>“两条路。要么顺着版本改打法，练那几个稳的英雄，靠团队吃饭；要么花三个月把手上的东西全部重建，但这段时间你可能连替补位都坐不上。”</span></p><p>你站在门口，出门的时候又低了低头。</p>",portrait:"assets/coach-zhou.webp",options:s=>[
    option("顺着版本改打法","精力+2，操作+1；反应-1",()=>{gain(s,"END",2,"adapt");gain(s,"MEC",1,"mechanics");s.attrs.REA=clamp(s.attrs.REA-1,1,99)}),
    option("推倒重建手上的东西","对线+2，反应+1；未来2个月教练信任-4",()=>{gain(s,"LAN",2,"laning");gain(s,"REA",1,"reaction");change(s,"coachFavor",-4)})]},
  {id:"rain_final",once:true,phase:["academy"],title:"暴雨里的决赛，父亲却没有出现",body:"<p>开赛前你在选手席上往台下看了一眼。雨很大，观众席上的人稀稀拉拉，都缩在雨衣里。你一个位置一个位置扫过去——中间区域，第四排，他通常坐的那个位置。空的。</p><p>第一局你打得很急，两次送头。中场休息你拿起手机，没有消息。</p><p>2比1，你们赢了。你摘下耳机没有动，手心里全是汗。散场后你走出场馆，雨还在下，安安在门口等着，伞也顾不上打，衣服湿透了。她喘着气：<span class='dialogue'>“你爸来之前接到电话，厂里机器出问题了，他折回去了。他让我跟你说——”</span></p><p>雨很大，她的声音几乎被盖过去：<span class='dialogue'>“他说他看了直播。你最后那个大招，他看到了。”</span></p><p>你站在原地，雨水顺着下巴往下滴。你没说好，也没说不好。安安站在那里，陪你一起淋着。</p>",portrait:"assets/chen-anan.webp",options:s=>[
    option("给父亲打电话，说你赢了","家庭+10，心态+1；不追问缺席",()=>{change(s,"family",10);gain(s,"MEN",1,"will")}),
    option("把失望说出来","家庭-6；长期压力下降，状态+4",()=>{change(s,"family",-6);change(s,"form",4);s.risks.familyFatigue=Math.max(0,(s.risks.familyFatigue||0)-6)})]},
  {id:"firstteam_veteran",once:true,phase:["firstteam","pro"],title:"老队员要你训练后留下来收设备",body:"<p>训练赛刚结束，一瓶水从桌子那头滚到你脚边。<span class='dialogue'>“新人都这样。外设收好，线理好，垃圾带出去。”</span></p><p>说话的人已经站起来了。他比你大六岁，一队出场次数比你多两位数。他不是在跟你商量。</p><p>你蹲下来，把那瓶水捡起来放在凳子上。休息室里有人在笑，不是恶意，更像是一种——“看你怎么选”的等待。</p>",options:s=>[
    option("先做一个月，再靠表现说话","教练信任+6，精力-8；心态-1",()=>{change(s,"coachFavor",6);change(s,"fitness",-8);s.attrs.MEN=clamp(s.attrs.MEN-1,1,99);log(s,"story","你收了。一个月后你在一队训练赛里给他让了一个人头，他拿到了，回头看了你一眼，什么也没说。")}),
    option("拒绝，把时间用来加练","心态+1，操作+1；短期首发概率下降",()=>{gain(s,"MEN",1,"pressure");gain(s,"MEC",1,"finish");change(s,"coachFavor",-5);log(s,"story","你去加练了。第二天你到训练室时，发现设备已经被人收好了。你没有去问是谁。")})]},
  {id:"bench_promise",phase:["firstteam","overseas","pro"],title:"教练说“下场一定给你机会”",body:"<p>这句话你听到第三遍了。第一次是主场大胜之后，他说“下场轮换”；第二次是杯赛之前，他说“这场让你打”。结果两次你都在替补位坐满90分钟，第二次甚至连热手都没叫到你。</p><p>这次他是主动找你的：<span class='dialogue'>“我知道你在等。我也在等一个让你上的时机。”</span>你看着他，点了头。</p><p>走出门的时候你收到一条消息——隔壁战队的助教通过熟人递话：<span class='dialogue'>“如果你公开表达想走，我们这边就去谈。”</span></p><p>你锁掉手机。训练室里的灯还亮着。</p>",portrait:"assets/coach-zhou.webp",options:s=>[
    option("继续沉默训练","教练信任+7，心态+1；人气不变",()=>{change(s,"coachFavor",7);gain(s,"MEN",1,"pressure")}),
    option("通过媒体释放离队意愿","人气-1，转会报价概率上升",()=>{change(s,"fame",-1);s.flags.wantsMove=true})]},
  {id:"parents_hospital",once:true,maxMoney:60,phase:["firstteam","overseas","pro"],minAge:16,title:"父亲的住院押金",body:"<p>缴费单上的数字你看了两遍。你现在的工资够一部分，但缺口不小。队医说你爸需要长期治疗，不是一次性的。</p><p>电话响了，一个没有保存的号码。对面自称是朋友的朋友，知道你家里情况，说可以借20万，不打欠条，不催还。条件很简单——下一场比赛，你的输出数不要超过一次。<span class='dialogue'>“不影响胜负，没人会知道。”</span></p><p>你挂掉电话，站在医院走廊里。ICU的门关着，你爸在里面。护士说你可以在外面等，也可以先回去训练。</p><p>你坐在塑料椅上。走廊很长，灯管有一根在闪。你知道这笔钱是什么性质，也知道——不接它，你爸的治疗可能拖不到你发下个赛季的工资。</p><p>走廊尽头，电梯门开了一下，又关上。</p>",portrait:"assets/father.webp",options:s=>[
    option("拒绝，向战队申请预支","家庭+8，战队信任-5；欠下12万",()=>{change(s,"family",8);change(s,"coachFavor",-5);addMoney(s,-12);s.debt=(s.debt||0)+12;log(s,"story","财务说需要审核，下周五才给答复。你在走廊坐了很久，最后站起来，去缴费窗口先付了一部分。")}),
    option("联系公益与队友筹款","人气-7，家庭+6；隐私被公开",()=>{change(s,"fame",-7);change(s,"family",6);log(s,"story","周骁第一个转了账，附言写的是“不用还，以后请我吃饭就行”。你盯着那行字看了很久。")}),
    option("接受那笔“借款”","立刻+20万；涉赌暗雷大幅上升，可能毁掉生涯",()=>{addMoney(s,20);s.flags.bettingEver=true;change(s.risks,"gambling",38);log(s,"bad","你收下了这笔见不得光的钱。眼下风平浪静，但你心里清楚它迟早要还。");log(s,"story","回到病房时你爸醒了，他看着你，没问钱的事，只说了一句：“你眼睛怎么红了。”你说外面风大。")},"danger")],weight:1.25},
  {id:"language_wall",once:true,phase:["overseas"],title:"你听错了教练的最后一句话",body:"<p>最后十分钟，教练朝你喊了一句话。你听见了“back”和“hold”，理解为回撤保住领先。你回撤了。对面从你这一侧切进来，团灭，被翻盘。</p><p>休息室里没有人用中文。没有人骂你，但也没有人替你说话。队长——不是跟你一个国家的——走过来拍了拍你的肩膀，什么也没说，然后走了。</p><p>你坐在柜子前面，翻译发来一条消息：<span class='dialogue'>“他让你压进团战，不是拉边。”</span>你盯着那条消息看了很久。你听懂了每一个词，但你听错了意思。</p><p>基地里的人在聊别的事了。你坐在那里，把耳机戴上又摘下来，反复了两次。</p>",options:s=>[
    option("公开承担责任，增加英语课","语言+18，教练信任-2；心态+1",()=>{change(s,"language",hasTalent(s,"language_gift")?30:18);change(s,"coachFavor",-2);gain(s,"MEN",1,"pressure")}),
    option("让翻译解释是指令不清","教练信任-10，状态+4",()=>{change(s,"coachFavor",-10);change(s,"form",4)})]},
  {id:"lonely_christmas",once:true,notMarried:true,phase:["overseas"],title:"圣诞夜，视频那头没有人说话",body:"<p>你这边下午三点，圣诞夜刚过了一半。她那边凌晨一点，窗外还在下雪。</p><p>视频接通的时候她没露脸，屏幕上是宿舍的天花板，灯关着，只有手机屏幕的光映出一小片轮廓。她的声音闷在枕头里：<span class='dialogue'>“没事，我就是……把手机开着，你要说话的话我听得见。”</span></p><p>你问她今天怎么过的。她说去了一趟超市，买了半只烤鸡，自己煮了一碗面，<span class='dialogue'>“跟平时差不多”</span>。</p><p>你沉默了一会儿，说：<span class='dialogue'>“我这边的圣诞树已经摆出来了。”</span>她轻轻笑了一声，像是怕吵醒室友：<span class='dialogue'>“那你替我看一眼。”</span></p><p>你从窗边往外看，街上有人戴着圣诞帽在跑。你想跟她说这些，但觉得说出来都太轻了。最后你只说：<span class='dialogue'>“挺好的。”</span></p><p>她没有回话。过了很久你才听见她均匀的呼吸声——她举着手机睡着了。你盯着屏幕上那一片黑暗，没有挂断。</p>",portrait:"assets/chen-anan.webp",condition:s=>s.relationship.status==="异地",options:s=>[
    option("承认自己很想家","感情+12，心态+1；第二天训练状态-4",()=>{changeLove(s,12);gain(s,"MEN",1,"love");change(s,"form",-4)}),
    option("说一切都很好","维持专注，状态+5；感情-12",()=>{change(s,"form",5);changeLove(s,-12)})]},
  {id:"overseas_party",once:true,phase:["overseas"],minAge:17,title:"队友说，放松也是职业的一部分",body:"<p>周六晚上，没有比赛。休息室里换好衣服，有人拍了拍你的肩膀：<span class='dialogue'>“一起走，所有人都去。”</span>所有人。你去还是不去，都在被观察。</p><p>你站在衣柜前，手机日历上写着明天的康复安排——手腕理疗、肩颈拉伸、低强度手感训练。队医用荧光笔画了三条线。</p><p>队友已经在门口等了，回头看了你一眼，笑了一下：<span class='dialogue'>“不来也没事。但来比较好——你知道的。”</span></p><p>他说“你知道的”的时候，语气很轻，像是在教你一个没有人写在纸上的规则。</p>",options:s=>[
    option("去，但设好离场时间","状态+5；精力-8，夜生活累积隐患",()=>{change(s,"form",5);change(s,"fitness",-8);s.clubNights=(s.clubNights||0)+1;log(s,"story","你坐了一个小时，喝了两杯汽水。离场时有人喊“这么早？”你摆摆手说明天有恢复计划。有人笑了一声，但笑里没有恶意。")}),
    option("拒绝，独自留在基地","精力+10；状态-4，心态+1",()=>{change(s,"fitness",10);change(s,"form",-4);gain(s,"MEN",1,"pressure");log(s,"story","你回到房间，洗完澡，坐床上刷了会儿手机。零点时你听到楼下有车回来，有人在笑，有人用你的母语喊了句什么，没听清。")})]},
  {id:"agent_contract",once:true,phase:["firstteam","overseas","pro"],minAge:17,portrait:"assets/agent-wang.webp",title:"经纪人把“保证首发”写进了口头承诺",body:"<p>会面约在一家安静得连水声都听得见的咖啡馆。你的经纪人王哥把合同推过来，封面很干净，里面密密麻麻的条款。</p><p>他说可以给你更高的工资，可以帮你运作转会，可以让你进国家队名单：<span class='dialogue'>“我跟你们教练很熟，他说了你就是未来核心。”</span>你说的每一句话他都点头。你说你要保证首发，他说<span class='dialogue'>“当然，这是我谈的前提。”</span></p><p>你翻到签字页。八年。肖像权、转会决定权、商业开发权全部打包。你问“保证首发”能不能写进合同。他笑了一下，很短，但很职业：<span class='dialogue'>“兄弟，这个写了也没用，教练换了你找谁去？”</span></p><p>他说的是实话。他的笑容也是实话。</p>",options:s=>[
    option("签长约，换取眼前资源","人气+9，报价+1；未来转会抽成高",()=>{change(s,"fame",9);s.agent={type:"aggressive",cut:18};generateOffers(s,1);log(s,"story","你签字的时候，他接了个电话，对着那头说“搞定了”。你低头看着自己的签名，墨迹还没干。")}),
    option("请独立律师，只签两年","花费6万，心态+1；资源增长较慢",()=>{addMoney(s,-6);gain(s,"MEN",1,"pressure");s.agent={type:"careful",cut:8};log(s,"story","他听完你的决定，笑容没消失，但嘴角的角度变了：“行，那先做两年看看。到时候你身价翻倍了，可别忘了老哥。”")})]},
  {id:"xiaoman_private",once:true,notMarried:true,phase:["firstteam","pro"],minAge:17,title:"粉丝拍到了你和安安",body:"<p>照片是在商场门口拍的。你戴着口罩，她扎着马尾，你们之间隔了半个身位，她正偏头跟你说话。</p><p>评论不到两小时就破了五百。有人在扒她的学校、专业，有人说<span class='dialogue'>“穿成这样怎么配得上”</span>，有人贴了她在食堂吃饭的照片——不知道什么时候拍的。战队打来电话，建议你<span class='dialogue'>“暂时不要公开回应”</span>，让热度自己降下去。</p><p>你翻到安安的对话框。她已经知道了，发来一条：<span class='dialogue'>“我没事，你别看评论。”</span></p><p>你打电话过去，她接得很快。第一句话是：<span class='dialogue'>“那些话我不在乎。”</span>顿了一下，又说：<span class='dialogue'>“但我在乎你会不会因为我在乎而乱做决定。”</span></p><p>你没有回答。她等了一会儿，轻声说：<span class='dialogue'>“你自己选。选完别后悔就行。”</span></p>",portrait:"assets/chen-anan.webp",condition:s=>["恋人","异地"].includes(s.relationship.status),options:s=>[
    option("承认恋情，要求停止打扰她","感情+15，人气波动；商业机会-1",()=>{changeLove(s,15);change(s,"fame",chance(.55)?5:-6);s.flags.publicLove=true;log(s,"story","你发完声明三分钟后，她发来一条语音，声音有点哑：“你傻不傻。”然后是很长的沉默，“傻完了记得回来。”")}),
    option("按战队口径否认","人气+3；感情-20，可能留下裂缝",()=>{change(s,"fame",3);changeLove(s,-20);s.relationship.denied=true;log(s,"story","你打完电话之后，她的头像暗了很久。晚上你收到一条消息：“我理解。”后面没有别的了。")})]},
  {id:"girlfriend_offer",once:true,notMarried:true,phase:["firstteam","campus","pro"],minAge:18,title:"安安拿到了外地研究生名额",body:"<p>她把录取通知书放在桌子中间，正面朝你。你看了一眼那个城市——高铁四个半小时，航班一小时四十分钟，不算远，也不算近。</p><p>她没有看你，手指搁在杯子边上，来回摩挲杯沿：<span class='dialogue'>“我不是在考验你，也不是要你留我。我只是想告诉你。”</span></p><p>你问她想去吗。她终于抬起头，目光直直地看着你：<span class='dialogue'>“我想去。那个研究方向，全国只有这个组在做。”</span>她说这句话的时候眼睛是亮的。</p><p>她没有说“你怎么办”，没有说“我们怎么办”。她只是告诉你，她想往前走一步。你沉默了很久，她也没有催，只是把杯子端起来喝了一口，等你说完该说的话。</p>",portrait:"assets/chen-anan.webp",condition:s=>s.relationship.status==="恋人",options:s=>[
    option("支持她去，开始异地","感情+8，状态-4；关系转为异地",()=>{changeLove(s,8);change(s,"form",-4);s.relationship.status="异地";log(s,"story","她听完你的话，低下头，过了很久才说：“那我买票了。”声音很平静，但你注意到她握着杯子的手指稍微用了点力。")}),
    option("希望她留下","当前感情+4；长期冲突+18",()=>{changeLove(s,4);s.relationship.conflict=(s.relationship.conflict||0)+18;log(s,"story","你话还没说完她就摇了摇头，表情没有愤怒，只有一点失望：“那你能把刚才那句话再说一遍吗？看着我说。”你说不出口了。")})]},
  {id:"match_fixing",once:true,maxMoney:60,phase:["pro"],minAge:18,title:"他们只要一个无关胜负的失误",body:"<p>消息是通过一个你不太熟的号码发来的。对方知道你父亲在哪家医院、住哪一床、欠了多少。</p><p>他说比赛结果不变，只需要你在第一局十分钟前主动送掉一个人头。一次失误而已。不影响胜负，没有人会注意。他发了一个数字，够你付清剩下的押金，后面跟了一句：<span class='dialogue'>“决定权在你。”</span></p><p>你放下手机。病房里你爸在睡觉，心电图的声音平稳地一跳一跳。你握了握拳头，指甲掐进掌心里。</p><p>然后你给那个号码回了一条消息。你回的是什么，只有你自己知道。</p>",options:s=>[
    option("保存证据并报告战队","短期被调查和雪藏；职业风险大幅下降",()=>{change(s,"coachFavor",-8);change(s,"form",-8);change(s.risks,"gambling",-30);s.flags.reportedFixing=true;log(s,"story","你把截图发给了合规部门。之后三天没有任何回复。第四天，那个号码发来一个大拇指的表情——然后再也没有出现过。")}),
    option("删除消息，什么也不说","本月没有损失；暗雷仍可能回来",()=>{change(s.risks,"gambling",6);log(s,"story","你删掉之后去洗了把脸。镜子里的你跟平时一样。你对着镜子站了一会儿，然后回病房了。")}),
    option("按他说的做","获得35万；涉赌风险+45，成就与国际赛资格可能永久失去",()=>{addMoney(s,35);s.flags.bettingEver=true;change(s.risks,"gambling",45);log(s,"story","第一局第八分钟，你在河道多走了两步，被抓死。一次失误。没人注意到你是故意的。这一局结束你摘下耳机，手心全是汗。")},"danger")]},
  {id:"health_test",once:true,phase:["pro"],minAge:18,title:"一次健康筛查的结果需要复核",body:"<p>队医把你叫到办公室，门关上了。他说话很慢，每一个字都像提前打过草稿——初筛有一项指标需要复核，不一定严重，但需要你去正规医疗机构做一次完整检查。</p><p>他把转诊单推过来，指了指地址：<span class='dialogue'>“这家医院，我帮您约好了时间。”</span>你问如果复查结果不好会怎样。他说：<span class='dialogue'>“先查，查完再说。不管结果是什么，隐私受法律保护，治疗和继续工作都有规范路径可循。”</span></p><p>你把转诊单叠好放进口袋。站起来时他补了一句：<span class='dialogue'>“高强度训练先缓一缓，等结果出来再调整计划。”</span></p><p>你走出门，走廊尽头的队友在喊你热手。你摸了摸口袋里那张纸，然后迈开步子跑过去——但你的速度比平时慢了一点，只有你自己知道。</p>",condition:s=>(s.clubNights||0)>=4&&!s.flags.healthTested,options:s=>[
    option("立即复核并暂停高强度训练","精力-8；伤病风险-18，获得正规支持",()=>{s.flags.healthTested=true;change(s,"fitness",-8);if(chance(.16)){s.flags.hivDiagnosed=true;s.healthCare=80;log(s,"story","复核确诊HIV。医生说明：规范抗病毒治疗可长期控制病毒，确诊不是职业与人生的终点。") }else{s.injury.risk=clamp((s.injury.risk||0)-18);log(s,"good","复核结果排除了感染。你接受了更完整的性健康咨询。")}}),
    option("推迟一个月，先保住首发","状态+5；伤病风险+12，人气-3",()=>{change(s,"form",5);s.injury.risk=clamp((s.injury.risk||0)+12);change(s,"fame",-3)},"danger")]},
  {id:"hiv_treatment",once:true,phase:["pro"],minAge:18,title:"治疗不会替你打职业，但能让你继续生活",body:"<p>医生的语气很平，像是在念一份操作手册：<span class='dialogue'>“目前HIV感染已经有规范的治疗方案，只要坚持服药、定期复查，病毒可以被长期抑制。不影响正常生活，不影响工作。”</span></p><p>他把处方笺推过来：<span class='dialogue'>“保密是医疗常规。你的病史只会留在本院的系统里，不会有第二个人知道。”</span>你低头看那张处方笺，上面的药名你从来没有听说过。</p><p>你问了一句：<span class='dialogue'>“如果我间断服药呢？”</span>医生的表情第一次有了变化，很轻，像是失望也像是遗憾：<span class='dialogue'>“耐药之后，治疗选择会越来越少。”</span></p><p>你收好处方笺，站起来之前又坐了回去。诊室的白炽灯很亮，外面走廊里有人在打电话，笑着说明天去哪里吃饭。你坐了很久，医生没有催你。</p>",condition:s=>s.flags.hivDiagnosed&&(s.healthCare||0)<100,options:s=>{const rich=(s.money||0)>=500,arr=[];if(rich)arr.push(option("按医嘱规范治疗（花500万）","病毒长期抑制，身体不再被拖累；心态+2",()=>{addMoney(s,-500);s.healthCare=100;s.flags.hivIntermittent=false;gain(s,"MEN",2,"will");log(s,"good","你负担起了规范治疗。按医嘱服药、定期复查，训练照常。")}));arr.push(option(rich?"省下这笔钱，间断治疗":"负担不起500万，只能间断治疗","每月精力-30、伤病风险上升，直到你能规范治疗",()=>{s.flags.hivIntermittent=true;log(s,"bad","药断断续续地吃。身体一天天被拖垮，你只能盼着哪天付得起规范治疗。")},"danger"));return arr}},
  {id:"national_wrong_position",phase:["pro"],minAge:18,title:"教练要你临时改练一个新位置",body:"<p>教练在白板上点了一下另一条路：<span class='dialogue'>“你手速够快，那个位置现在没人顶得住。回去把版本英雄过一遍，明天训练赛就按这个排。”</span></p><p>你没有马上回答。你练了十年的是这一个位置，兵线、视野、开团时机——所有比赛习惯都建立在这个位置上。换到那条路要重学兵线节奏、重排视野、还要跟一个从没配合过的队友磨默契。助理教练在旁边补了一句：<span class='dialogue'>“队伍现在这个位置上缺人，你先顶一下。”</span></p><p>走出战术室，你收到战队教练的消息：<span class='dialogue'>“听说他们要你换位置？你的训练安排需要调整吗？”</span></p><p>你站在走廊里。一边是国际赛的名额——拒绝了可能再也没有下一次；一边是你花了十年打磨的肌肉记忆。你把手机锁屏，走廊尽头有人喊你去看录像。</p>",condition:s=>s.national.called,options:s=>[
    option("接受这个位置","版本适应+15，心态+1；操作成长放缓",()=>{change(s.national,"adapt",15);gain(s,"MEN",1,"national");s.flags.outOfPosition=true;log(s,"story","你花两周恶补那个位置的对线细节。第一场训练赛送了两次头，一次是没适应视野盲区，一次是纯手滑。教练拍你肩说“适应得不错”——你没告诉他，你每晚回房间还在看别人的第一视角。")}),
    option("说明自己只打得了本职位置","操作+1；队内信任-12",()=>{gain(s,"MEC",1,"finish");s.national.adapt=clamp(s.national.adapt-12);log(s,"story","你跟教练谈完，他说“我理解你的想法”，然后把你从首发名单里划掉了。你在观众席上看完了那场比赛——你的替补在右翼卫打了七十二分钟，数据一般，但没有失误。")})]},
  {id:"national_injury",phase:["pro"],minAge:18,title:"队医建议打一针封闭",body:"<p>夏季赛季后赛，四十八小时后。你的右手腕肿了一圈，但片子没有显示结构性损伤。队医蹲下来按了两下，站起来说：<span class='dialogue'>“打一针封闭，可以上。比赛完了再处理。”</span></p><p>战队的邮件已经在邮箱里躺着，措辞很明确：<span class='dialogue'>“我方选手目前处于疲劳恢复期，不建议在未经完整评估的情况下进行高强度比赛。”</span></p><p>你坐在治疗床边，队医在等你回答。走廊里传来队友热手时键盘摩擦地板的声音。教练不知道什么时候站在了门口，看着你说了一句：<span class='dialogue'>“国家需要你。”</span></p><p>他说完就走了。你没来得及问——他说的“国家”是指那件队服，还是指他自己这场不能输的比赛。</p>",condition:s=>s.national.called,options:s=>[
    option("打封闭首发","人气+10；25%伤停3—6个月",()=>{change(s,"fame",10);if(chance(hasTalent(s,"iron_man")?.14:.25))sufferInjury(s,rand(3,6));log(s,"story","针扎进去时你咬了一下牙。那天你打满了三局，有一次关键开团。下机时右手连鼠标都握不住，队医用冰袋敷了四十分钟。")}),
    option("拒绝冒险，回战队治疗","精力+10；版本适应-10，职业寿命更稳",()=>{change(s,"fitness",10);change(s.national,"adapt",-10);log(s,"story","你第二天飞回了战队。飞机上你关掉手机，不看新闻。落地开机后消息栏躺着几十条未读，你一条也没点开，直接开车去了队医那里报到。")})]},
  {id:"transfer_loyalty",phase:["pro"],minAge:19,title:"豪门报价，和一份队长承诺",body:"<p>两份东西几乎同时摆在桌上。左边是一份报价单，数字后面跟着好几个零，战队名字你从小就在电视上看过。右边是现任主教练的短信：<span class='dialogue'>“下赛季，队长是你。”</span></p><p>经纪人说豪门不能保证首发，但平台不是一个级别。主教练这边工资只有一半，但给你队长，给你 BP 上的话语权。</p><p>你坐在宿舍里，两样东西摊在桌面上，中间放着一瓶喝了一半的水。你想起周骁说过的一句话：<span class='dialogue'>“有人要你是因为你能用，有人要你是因为你是你。”</span></p><p>窗外的天快黑了。你把两份文件收进抽屉，哪一个都没回。</p>",options:s=>[
    option("留下争取队长","教练信任+15，可能成为队长；错过本期报价",()=>{change(s,"coachFavor",15);if(overall(s)>=82||hasTalent(s,"captain")){s.flags.captain=true;unlock("captain_armband")};s.offers=[]}),
    option("要求经纪人推动转会","生成2份高一级报价；教练信任-12",()=>{generateOffers(s,2,true);change(s,"coachFavor",-12)})]},
  {id:"brand_vs_rest",once:true,maxMoney:60,phase:["pro"],minAge:18,title:"一天广告拍摄，等于三个月康复费",body:"<p>品牌方档期只能排在休息日。经纪人打电话来：<span class='dialogue'>“机会难得，这个曝光量不拿白不拿。”</span></p><p>队医在旁边听到了，等你挂了电话，递过来一张恢复计划表：<span class='dialogue'>“你需要完整休息。连续训练和比赛之后，身体窗口期只有这几天。”</span>你看着他，他没再说第二句，把表放在桌上就走了。</p><p>你查了一下银行余额。父亲的住院账单还有一部分挂着。一天拍摄，三个月康复费的缺口。</p><p>你站在饮水机前面，接了一杯水，没喝，看着它慢慢凉下来。</p>",options:s=>[
    option("接下拍摄","收入+22万，人气+6；精力-14，伤病风险+8",()=>{addMoney(s,22);change(s,"fame",6);change(s,"fitness",-14);s.injury.risk+=8;log(s,"story","拍摄那天你站了七个小时，换了四套衣服。晚上回基地，小腿有点发紧。你冰敷了二十分钟才去睡。")}),
    option("拒绝，完成恢复","精力+20，状态+3；没有额外收入",()=>{change(s,"fitness",20);change(s,"form",3);log(s,"story","你回绝之后经纪人沉默了几秒，说“那我帮你推到下个月”。队医不知道这件事，但你第二天出现在恢复室时他什么也没问，只是把训练计划往前推了一页。")})]},
  {id:"captain_cover",phase:["pro"],minAge:20,title:"队友酒驾，队长要不要替他先挡住媒体",body:"<p>队友是凌晨被拦的。消息到中午还没上新闻，但战队内部已经知道了。</p><p>你作为队长被叫进办公室，公关总监把一张稿纸推过来：<span class='dialogue'>“你先发个声，说队内问题已经处理了，维护一下集体形象。”</span>你问了一句：<span class='dialogue'>“警方通报出来了吗？”</span>公关总监看了你一眼：<span class='dialogue'>“还没有。但等通报出来再回应就晚了。”</span></p><p>玻璃窗外训练室里队友们在热手，那个酒驾的人也在场上。你不知道他酒驾的时候车上有没有别人，也不知道他知不知道你正在替他做决定。</p><p>稿纸上的字很简短——“队内问题已经解决，我们是一个团结的集体。”你拿起那张纸，没有签字。</p>",condition:s=>s.flags.captain||hasTalent(s,"captain"),options:s=>[
    option("拒绝背书，只谈战队纪律","教练信任-6；公众人气+10",()=>{change(s,"coachFavor",-6);change(s,"fame",10);log(s,"story","你在镜头前说“在结果出来之前，任何个人观点都代表不了这个集体”。回休息室的路上，那个队友从你身边经过，没有看你。")}),
    option("按战队稿件发言","教练信任+6；人气-9",()=>{change(s,"coachFavor",6);change(s,"fame",-9);log(s,"story","你说完稿子上的话，放下手机，发现评论区已经炸了——“队长出来洗地了。”你没有再打开手机。")})]},
  {id:"xiaoman_interview",once:true,notMarried:true,phase:["pro"],minAge:20,title:"安安接受了一次关于你的采访",body:"<p>原稿发到你手上的时候，标题是深度采访的格式。安安在里面说你<span class='dialogue'>“把一个普通人的情绪全部交给了比赛”</span>，说<span class='dialogue'>“和他生活很累，因为他把所有东西都吞下去，到赛场才倒出来”</span>。</p><p>她还说了你第一次签职业合同那天晚上给她打电话，什么也没说，就在电话那头喘气。她用的是“喘气”，不是“哭”。</p><p>见报那天标题被改了：《电竞选手女友控诉多年牺牲：他把所有情绪都给了比赛》。评论区又炸了，有人骂她蹭热度，有人说“赚那么多钱还矫情”。</p><p>你打电话给她，她接起来第一句是：<span class='dialogue'>“标题不是我起的。”</span>沉默了一会儿，又说：<span class='dialogue'>“但那些话是我说的，我不后悔。你要否认就否认，我不需要你帮我解释。”</span></p><p>她的语气很平静，但你知道她不是无所谓。她只是把选择权又丢回给了你，然后自己去扛剩下的。</p>",portrait:"assets/chen-anan.webp",condition:s=>["恋人","异地"].includes(s.relationship.status),options:s=>[
    option("先和她谈，再共同澄清","感情+8；人气+1",()=>{changeLove(s,8);change(s,"fame",1);log(s,"story","见面时她第一句话是：“你不用道歉。我只是觉得，有些话总要有人说出来。”那天晚上你们坐在操场边的台阶上，说了很久。")}),
    option("让经纪人单方面否认","人气+3；感情-18，冲突+15",()=>{change(s,"fame",3);changeLove(s,-18);s.relationship.conflict=(s.relationship.conflict||0)+15;log(s,"story","声明发出去半小时后，你收到她最后一条消息：“原来你连跟我一起面对都觉得麻烦。”之后对话框里再也没有出现过她的头像。")})]},
  {id:"red_card_choice",phase:["firstteam","overseas","pro"],title:"对面在赛后握手时说了一句话",body:"<p>上一局你们被翻盘，对面的中单在最后一波团里对着你的尸体打了个字。全场都看见了。</p><p>中场休息，两队在通道里错身。他放慢了半步，用只有你们两个人听得见的音量说：<span class='dialogue'>“你手不行，别硬拿那个英雄。”</span></p><p>队长在前面头也不回地丢了一句：<span class='dialogue'>“别理他。”</span></p><p>后台的摄像机就在三米外，红灯亮着。你的手已经攥起来了。</p><p>所有人在等你选。</p>",options:s=>[
    option("用下一次进攻回应","心态+1，状态+4；需要压住情绪",()=>{gain(s,"MEN",1,"clutch");change(s,"form",4);log(s,"story","你没有跟他吵，只是把兵线推过去，把视野插好。两分钟后你抓死了他一次，然后把人头让给了打野。你没看他，但你知道他在看你。")}),
    option("替队友强硬出头","心态+1，教练信任-4；40%停赛1个月",()=>{gain(s,"MEN",1,"team");change(s,"coachFavor",-4);if(chance(.4)){s.suspension=1;log(s,"warn","你的报复动作被追加停赛1个月。")}})]},
  {id:"study_contract",phase:["campus"],title:"职业试训，和安安的毕业答辩",body:"<p>CQG 只给一次三天试训。最后一天，正好是安安的毕业答辩。</p><p>她比你先知道这件事。你还在纠结要不要告诉她的时候，她已经把你的训练日程表打印出来贴在书桌上了：<span class='dialogue'>“三天，第一天适应，第二天对抗，第三天比赛。你第三天早上答辩前出发，来得及赶上下午的对抗。”</span></p><p>你问她答辩几点。她说上午十点。<span class='dialogue'>“你不用回来。”</span>语气跟说“今天可能要下雨”一样平常，<span class='dialogue'>“我准备了很久，不是让你回来听的。”</span>但你听得出来，这句话不是“不需要”，而是“不能说需要”。</p><p>那天晚上你躺在床上，她在隔壁房间背稿。你听见她偶尔停下来，深呼吸，再从头开始。</p><p>第二天早上你起来时，桌上放着一份早餐和一张纸条：<span class='dialogue'>“答辩顺利的话，我中午在校门口等你。”</span>她没有写“如果你在的话”。</p>",portrait:"assets/chen-anan.webp",options:s=>[
    option("参加全部试训","人气+18，职业机会大增；感情-14",()=>{change(s,"fame",18);changeLove(s,-14);log(s,"story","比赛结束后你才看到——她发来一张照片：学士服，手里一束花，一个人站在答辩教室门口笑着，配文“过了”。你拿着手机站了很久。")}),
    option("提前离队赶回答辩","感情+15，心态+1；试训成功率下降",()=>{changeLove(s,15);gain(s,"MEN",1,"love");change(s,"fame",-6);log(s,"story","你出现在答辩教室后门时，她刚好念到致谢。她看见你，顿了一拍，继续往下念。结束后她在走廊拉住你，眼睛红了：“你不该回来的。”但拉着你袖子的手没松开。")})]},
  {id:"reconcile",once:true,phase:["firstteam","overseas","campus","pro"],minAge:19,title:"很久没亮的号码又亮了",body:"<p>对话框沉到很下面了。你没有删过聊天记录，但也很久没有往上翻过。</p><p>那天晚上消息弹出来的时候，你刚洗完澡，屏幕上只有一行预览：<span class='dialogue'>“我到你在的城市了，明天下午走。有空的话，一起吃个饭？”</span></p><p>你盯着那条消息看了很久。上一次见面是多久之前了？你甚至想不起最后一次说话的语气。你点进去，看见上一条消息还是她发的——“我理解。”后面什么都没有了。</p><p>你打了一行字：“几点，哪儿？”又删掉。又打：“好久不见。”又删掉。最后你发了一个字：<span class='dialogue'>“好。”</span>她回得很快：<span class='dialogue'>“那我把地址发你。”</span></p><p>地址发过来了，是一家你以前常去的面馆。她什么都没多说，但你知道，那个地方，吃一顿饭的时间比一顿饭本身要长。</p>",portrait:"assets/chen-anan.webp",condition:s=>s.relationship.status==="分手",options:s=>[
    option("赴约，试着重新开始","有机会复合；也可能只是好好告别",()=>{if(chance(.55)){s.relationship.status=phaseOf(s)==="overseas"?"异地":"恋人";s.relationship.love=42;s.relationship.conflict=0;s.flags.breakupQueued=false;change(s,"form",5);log(s,"good","你们决定重新试试。这次你不想再拿比赛当借口。")}else{change(s,"form",-2);gain(s,"MEN",1,"will");log(s,"story","一顿饭聊了很多，笑着笑着都明白，回不去了。")}}),
    option("婉拒，把力气留给赛场","状态+4，操作+1；关系仍为分手",()=>{change(s,"form",4);gain(s,"MEC",1,"finish");log(s,"story","从那以后，你每次击杀后都会不自觉地往观众席某个方向看——即使知道她不在那里。")})]},
  {id:"contract_renewal",phase:["pro"],minAge:19,title:"续约合同摆到了桌上",body:"<p>战队开出的条件是三年，工资涨幅不大，但有绩效奖金。经纪人看了一眼数字，在桌子底下给你发消息：<span class='dialogue'>“这个数低了，我可以再压一压，但可能会惹恼管理层。”</span></p><p>对面的经理在等你签字，笔已经放在纸上了：<span class='dialogue'>“战队很看重你，希望把你作为长期计划的一部分。”</span></p><p>你拿起笔，没有马上签。经理看着你，脸上的笑容很职业，他在等你做选择——涨薪或者安稳。</p><p>经纪人还在看你。你突然意识到，这个房间里没有一个人是在替你想“打职业”这件事。</p>",options:s=>[
    option("强硬要求涨薪","月薪上调；教练信任-8，人气-4",()=>{s.salary=Math.round((s.salary||4)*1.35);change(s,"coachFavor",-8);change(s,"fame",-4);log(s,"story","经理听完你的要求，把笔收了回去：“那我需要跟上面汇报。”他站起来时椅子腿蹭了一下地板。经纪人随后发来消息：“有戏，但接下来三个月你可能要多等一会儿了。”")}),
    option("接受平稳续约","月薪小涨，教练信任+6；错过一次要价机会",()=>{s.salary=Math.round((s.salary||4)*1.1);change(s,"coachFavor",6);log(s,"story","你签完字，经理跟你握了手，手心是热的：“合作愉快。”走出门时你收到一条消息——另一家战队：”听说你续了？好吧，祝好。”")})]},
  {id:"young_rival",phase:["firstteam","pro"],minAge:18,title:"战队签来一个同位置的新星",body:"<p>他比你小一岁，签进来的时候战队官宣配了两张海报。媒体拿你俩比，标题写的是“新老交替还是良性竞争？”</p><p>训练第一天，他在你对面打。第一次对抗，他用手速生吃了你一次；第二次你卡住位置没让他转身；第三次他主动过来跟你碰了一下拳头。</p><p>晚上你刷手机，看到他的采访：<span class='dialogue'>“我很尊重前辈，我来是学习的。”</span></p><p>你把手机扣在桌上。你知道那句话说得很得体，也知道他说的是真话。比假话更难消化。</p>",options:s=>[
    option("用更狠的训练回应","操作+1，反应+1；精力-12，伤病风险上升",()=>{gain(s,"MEC",1,"finish");gain(s,"REA",1,"lane");change(s,"fitness",-12);s.injury.risk+=6}),
    option("找教练谈清自己的定位","教练信任波动；心态+1",()=>{const ok=chance(.5);change(s,"coachFavor",ok?7:-7);gain(s,"MEN",1,"pressure")})]},
  {id:"loan_offer",phase:["pro"],minAge:19,title:"一份去小战队打首发的合同",body:"<p>报价摆在桌上：LDL 二级联赛，保级队，打满整个赛季，保证首发。对面教练亲自打了电话：<span class='dialogue'>“我需要你这种类型的选手，你来了就是战术核心。”</span></p><p>你现在的战队能赢，能打出漂亮的比赛，能跟顶级选手一起训练。但你上不了场——你已经连续七场坐在替补位上，一局都没上过。</p><p>经纪人把报价推过来：<span class='dialogue'>“这不是降级，这是去打职业。”</span></p><p>你没有回答。你看着窗外训练室里，一队在打分组对抗，屏幕上兵线一波波推过去，没有人停下来等你。</p>",condition:s=>s.coachFavor<45,options:s=>[
    option("接受，去打首发","出场大增、成长加快；人气-4，月薪略降",()=>{change(s,"coachFavor",60-s.coachFavor);change(s,"form",6);change(s,"fame",-4);s.salary=Math.max(2,Math.round((s.salary||4)*.85));log(s,"story","你降薪去了保级队，但终于每周都能上场。")}),
    option("留下继续抢位置","维持平台；出场少，状态-5",()=>{change(s,"form",-5)})]},
  {id:"sponsor_line",phase:["pro"],minAge:19,portrait:"assets/agent-wang.webp",title:"一个来路不明的博彩赞助",body:"<p>报价是市场价的三倍。条件只有一个：在社交媒体上发一条内容，穿他们提供的装备，不需要提品牌名字，只需要“无意间露出”。</p><p>合规部门的邮件抄送了你，措辞很谨慎：<span class='dialogue'>“此类合作在联赛框架内属于灰色地带，建议谨慎评估。”</span>王哥打来电话，语气兴奋：<span class='dialogue'>“这个数你不接就被人接了。到时候人家上了你却没上，你别后悔。”</span></p><p>你没有马上回答。你看着赞助方案上的品牌名，顺手搜了一下，发现它的母公司注册在一家你从没听过的小岛上。</p><p>你合上电脑。夜色里，手机屏幕又亮了，一条催促消息：<span class='dialogue'>“考虑得怎么样了？”</span></p>",options:s=>[
    option("拒绝，选干净的品牌","心态+1，人气+4；少赚一笔",()=>{change(s,"fame",4);gain(s,"MEN",1,"will");log(s,"story","你回复“不接”之后，对方没再发消息。两周后你看到那个报价出现在另一个选手的账号上。你划过那条帖子，没有点赞。")}),
    option("签下高额代言","立刻+30万；涉赌风险+30，埋下隐患",()=>{addMoney(s,30);s.flags.bettingEver=true;change(s.risks,"gambling",30);log(s,"story","你发出那条合作内容后，评论区第一条是“你也接这个了？取关。”你把它删了。但钱已经到账了。")},"danger")]},
  {id:"overseas_culture",once:true,phase:["overseas"],title:"休息室的玩笑你听不懂",body:"<p>不是听不懂单词。是所有人都笑了，你晚了三秒才反应过来那个梗是什么——等你反应过来的时候，笑点已经过了。</p><p>有人注意到了你的延迟，善意地跟你解释了一遍前因后果。你点了点头，笑了一下。但那个笑是表演性的，你知道，他也知道。</p><p>训练赛还没开始。基地里大家在调设备、聊天，开那个你听不懂的玩笑。你把鼠标垫抹平，比平时多抹了两遍。</p><p>下一次他们再笑的时候，你没有再等那个翻译延迟，低头开始调 DPI。你是屋里唯一一个没有笑的，但没有人注意到——因为你没有停下手里的动作，你一直在调那两个数字。</p>",options:s=>[
    option("硬着头皮融进去","状态+5，语言+6；精力-6",()=>{change(s,"form",5);change(s,"language",6);change(s,"fitness",-6)}),
    option("专注训练，少社交","操作+1，精力+6；状态-4",()=>{gain(s,"MEC",1,"finish");change(s,"fitness",6);change(s,"form",-4)})]},
  {id:"academy_cut",once:true,phase:["academy"],minAge:15,title:"青训队年底要裁掉三个人",body:"<p>周骁在食堂里跟你说的，声音压得很低：<span class='dialogue'>“名单我看到了。年底压缩名单，淘汰三个。”</span>他没有说你在不在上面，但他看着你的眼神已经说明他不知道怎么开口。</p><p>你问他另外两个是谁。他说了一个名字，然后停了一下：<span class='dialogue'>“反正，你自己心里有数。”</span></p><p>那天晚上你加练到操场关灯。保安大爷站在门口等你，手里晃着钥匙串：<span class='dialogue'>“又没人给你开门了是不是。”</span></p><p>你没有回答。你低头理耳机线，手指有点抖。</p>",portrait:"assets/coach-zhou.webp",options:s=>[
    option("加倍训练证明自己","操作+1，体力+1；精力-14，伤病风险上升",()=>{gain(s,"MEC",1,"finish");gain(s,"END",1,"stamina");change(s,"fitness",-14);s.injury.risk+=6}),
    option("找教练要一个明确标准","教练信任+6，人气+4；状态-3",()=>{change(s,"coachFavor",6);change(s,"fame",4);change(s,"form",-3)})]}
,
// ===== 新增剧情事件（批量整合）=====
{
  id:"academy_captain_test",
  phase:["academy"],once:true,
  title:"队长的位置摆在你面前",
  portrait:"assets/coach-zhou.webp",
  body:"<p>训练赛结束，周骁把一份 BP 权限表推到桌子中间。<span class='dialogue'>“谁签，下一场谁就是队长，BP 最后一手谁定。”</span></p><p>几个队友看了你一眼，没人动。那张纸就摊在桌上。</p>",
  options:s=>[
    option("伸手把那张纸签了","人气+8，队长身份",()=>{change(s,"fame",8);s.flags.captain=true;log(s,"story","你签了字。那一场的 BP 最后一手是你定的。")}),
    option("把纸推回给教练","心态+1，但可能得罪教练",()=>{gain(s,"MEN",1,"story");change(s,"coachFavor",-5);log(s,"story","你把那张纸推了回去。")})
  ]
},
{
  id:"academy_father_money",
  phase:["academy"],once:true,
  title:"牛皮信封",
  portrait:"assets/father.webp",
  body:"<p>你爸来青训队送棉被，临走从裤兜掏出一个牛皮纸信封，塞进你枕头底下。<span class='dialogue'>“别让你妈知道。”</span></p><p>你打开一看，是他半个月的夜班费。</p>",
  options:s=>[
    option("把钱塞回他帆布袋里","家庭+10",()=>{change(s,"family",10);log(s,"story","你把钱还了回去。")}),
    option("收下，说声‘回头还’","资金+15万，但家庭-5",()=>{addMoney(s,15);change(s,"family",-5);log(s,"story","你收下了那笔夜班费。")})
  ]
},
{
  id:"academy_first_goal",
  phase:["academy"],once:true,
  title:"第一个正式比赛人头",
  portrait:"assets/player.webp",
  body:"<p>青训联赛，你在中路抓死了对面。赛场边没什么人喝彩，只有基地门口一个穿工装的身影默默转身走了。</p><p>那个人你认识。</p>",
  options:s=>[
    option("冲到场边朝他挥手","家庭+8，情感回忆",()=>{change(s,"family",8);log(s,"story","你朝那个背影使劲挥手。")}),
    option("默默比赛，后面再说","心态+1",()=>{gain(s,"MEN",1,"story");log(s,"story","你咽下情绪，回到自己的位置上。")})
  ]
},
{
  id:"firstteam_overwork",
  phase:["firstteam","pro"],
  title:"连续加班加练",
  portrait:"assets/coach-zhou.webp",
  body:"<p>周骁让你每天加练两小时操作。你已经连续三周没休息过一天。膝盖开始酸胀。</p><p>队医写了个纸条：<span class='dialogue'>“建议轮休一场。”</span>周骁把它揉成一团。</p>",
  options:s=>[
    option("跟教练申请轮休","伤病风险-15，但教练信任-5",()=>{s.injury.risk=clamp((s.injury.risk||0)-15);change(s,"coachFavor",-5);log(s,"story","你递了轮休申请。")}),
    option("咬牙撑住，打封闭继续","教练信任+8；伤病风险+20",()=>{change(s,"coachFavor",8);if(!s.flags.health_warn){s.flags.health_warn=true;log(s,"warn","医生皱眉看着你的膝盖。")}s.injury.risk=clamp((s.injury.risk||0)+20)})
  ]
},
{
  id:"firstteam_gambling_approach",
  phase:["firstteam"],once:true,
  title:"“方便喝杯咖啡吗？”",
  portrait:"assets/player.webp",
  body:"<p>一个自称“粉丝”的人在基地外等你，递来一杯咖啡，随口聊了几句。临走塞给你一张名片：<span class='dialogue'>“哥几个凑钱下注，输赢都跟你无关。就是给点内部消息。”</span></p><p>名片背面只有一个手机号。</p>",
  options:s=>[
    option("当场撕掉","降低赌博风险至0",()=>{s.risks.gambling=0;log(s,"good","你撕了名片，扔进垃圾桶。")}),
    option("先留着，不联系","赌博风险+5",()=>{change(s.risks,"gambling",5);log(s,"story","名片夹进了手机壳后面。")}),
    option("收下，并约了下次见面","赌博风险+30；资金+10万",()=>{addMoney(s,10);change(s.risks,"gambling",30);log(s,"bad","你接过了那杯咖啡。")},"danger")
  ]
},
{
  id:"firstteam_lin_xiaoman_conflict",
  phase:["firstteam","pro"],notMarried:true,once:true,
  title:"她站在基地门口",
  portrait:"assets/chen-anan.webp",
  body:"<p>安安淋着雨看完训练，等你出来。<span class='dialogue'>“你上次说请假陪我去面试，你没来。”</span></p><p>她的语气很平静，像在陈述比分。</p>",
  options:s=>[
    option("道歉，解释训练任务","感情+5，但显得敷衍",()=>{changeLove(s,5);log(s,"story","你说对不起。她说：没事。")}),
    option("沉默，给她一把伞","感情+2，自尊心持平",()=>{changeLove(s,2);log(s,"story","你递了伞，她推开了。")}),
    option("“你该理解我”","感情-10",()=>{changeLove(s,-10);log(s,"bad","她说：那也要我变成你的粉丝才行吗？")},"danger")
  ]
},
{
  id:"pro_big_club_offer",
  phase:["pro"],once:true,condition:s=>s.fame>=50,
  title:"两个电话",
  portrait:"assets/agent-wang.webp",
  body:"<p>王哥打来两个电话：一个来自 LEC 中游战队，首发位置有保证；一个来自国内顶级豪门，薪水翻倍但竞争激烈。</p><p>他说：<span class='dialogue'>“你爸那边……要不要再想想？”</span></p>",
  options:s=>[
    option("去欧洲","资金-20万，人气+30；出国线开启",()=>{addMoney(s,-20);change(s,"fame",30);s.flags.go_abroad=true;log(s,"story","你买了单程票。")}),
    option("留国内豪门","资金+80万；竞争压力增大",()=>{addMoney(s,80);change(s,"fame",10);log(s,"story","你签了国内的大合同。")})
  ]
},
{
  id:"pro_father_hospital",
  phase:["pro"],once:true,condition:s=>s.family<40,
  title:"急诊室走廊",
  portrait:"assets/father.webp",
  body:"<p>你爸急性心梗住院。你妈在电话里说：<span class='dialogue'>“你不用回来，比赛重要。”</span></p><p>可你听出她在哭。</p>",
  options:s=>[
    option("请假连夜回去","家庭+20，精力-20，比赛缺阵",()=>{change(s,"family",20);change(s,"fitness",-20);sufferInjury(s,1);log(s,"story","你出现在了病房门口。")}),
    option("拜托表妹照顾，打完客场再说","家庭-10，职业态度+3",()=>{change(s,"family",-10);gain(s,"MEN",3,"story");log(s,"bad","你挂掉电话，发了一条朋友圈。")})
  ]
},
{
  id:"pro_gambling_debt",
  phase:["pro"],condition:s=>s.risks.gambling>=30,
  title:"“上次那事，该结了”",
  portrait:"assets/player.webp",
  body:"<p>你在基地停车场被两辆车堵住。副驾驶摇下窗，那人笑了笑。<span class='dialogue'>“兄弟，上次那些消息不够准啊……帮忙补个数？”</span></p><p>他伸出三根手指。不是三万。是三十万。</p>",
  options:s=>[
    option("老实给钱","资金-30万",()=>{addMoney(s,-30);log(s,"bad","你付了钱，但留下转账记录。")},"danger"),
    option("报警","警方介入；赌博风险清零；电竞名声受损-20",()=>{s.risks.gambling=0;change(s,"fame",-20);log(s,"story","你拨了110。")})
  ]
},
{
  id:"pro_corner_choice",
  phase:["pro"],condition:s=>s.national.called===true,
  title:"一个无关胜负的送头",
  portrait:"assets/coach-zhou.webp",
  body:"<p>季后赛最后一场，胜负已定。第三局收尾阶段，对面已经放弃抵抗，所有人都在等水晶爆掉。</p><p>你想起了很久以前一个承诺——无关胜负，只关底线。</p>",
  options:s=>[
    option("一下打出界，耗完时间","职业表现+1",()=>{gain(s,"MEN",1,"story");log(s,"story","你安稳地结束了比赛。")}),
    option("去打那波没必要的团","精力-15，心态+5",()=>{change(s,"fitness",-15);gain(s,"MEN",5,"story");log(s,"story","你从侧翼绕了进去。有人记住了这一刻。")})
  ]
},
{
  id:"pro_media_storm",
  phase:["pro"],weight:2,
  title:"摄像头后面的眼睛",
  portrait:"assets/player.webp",
  body:"<p>一场比赛你发挥失常，赛后某大V剪辑了你三次失误，配文：<span class='dialogue'>“这是他真实水平？”</span></p><p>转发量一小时内破万。</p>",
  options:s=>[
    option("公开发长文回应","若人气>80则舆论平息，否则更糟",()=>{if(s.fame>80){change(s,"fame",5);log(s,"good","多数粉丝选择相信你。")}else{change(s,"fame",-15);log(s,"bad","你被骂得更凶了。")}}),
    option("沉默，下一场用表现打脸","心态+2，舆情不加不减",()=>{gain(s,"MEN",2,"story");log(s,"story","你没有回应。三天后训练室加练到深夜。")})
  ]
},
{
  id:"pro_injury_knock",
  phase:["pro"],weight:2,
  title:"不经意的碰撞",
  portrait:"assets/player.webp",
  body:"<p>队内对抗赛，你跟对面前排对脚。小腿一阵发麻。队医跑过来问：<span class='dialogue'>“有声音吗？”</span></p><p>你摇了摇腿说没事。但那一下的声音，你自己听到了。</p>",
  options:s=>[
    option("立刻要求检查","伤停1周，伤病风险-20",()=>{sufferInjury(s,1);s.injury.risk=clamp((s.injury.risk||0)-20);log(s,"story","你没有逞强。")}),
    option("轻伤不下火线","可能恶化；得周骁信任+5",()=>{if(chance(.3)){sufferInjury(s,rand(2,4));log(s,"bad","那一下最终让你躺了几个月。")}else{change(s,"coachFavor",5);log(s,"story","你咬牙撑完了训练。")}})
  ]
},
{
  id:"pro_training_rival",
  phase:["pro"],weight:1,
  title:"休息室里的新面孔",
  portrait:"assets/player.webp",
  body:"<p>战队签了一个年轻选手，训练室里你旁边那个位置给了他。他看你的眼神，像在看一个已经过气的 ID。</p><p>你的位置没有铁打一说。</p>",
  options:s=>[
    option("主动带他练习，示好","人气+5",()=>{change(s,"fame",5);log(s,"story","你朝他伸出手说：欢迎。")}),
    option("加练得更凶，位置要靠抢","心态+3",()=>{gain(s,"MEN",3,"story");log(s,"story","你一个人练到所有灯都熄灭。")})
  ]
},
{
  id:"pro_marriage_proposal",
  phase:["pro"],notMarried:true,once:true,condition:s=>s.relationship.love>=80,
  title:"后备箱里的玫瑰",
  portrait:"assets/chen-anan.webp",
  body:"<p>安安生日那天，你开车，她坐副驾。后备箱里是你偷偷准备的玫瑰和戒指，车程还有一公里到家。</p>",
  options:s=>[
    option("靠边停车，求婚","结婚线开启；感情+20",()=>{s.flags.married=true;changeLove(s,20);log(s,"good","她哭了。你给她戴上戒指。")}),
    option("再等等，还不是时候","感情不变；错过一次机会",()=>{log(s,"story","你握紧方向盘，开过了那个路口。")})
  ]
},
{
  id:"pro_old_football",
  phase:["pro"],once:true,
  title:"那把旧键盘坏了",
  portrait:"assets/father.webp",
  body:"<p>训练回来，你发现背包夹层里那把旧键盘的线断了。你爸很多年前用绝缘胶带缠过的地方，断了。</p><p>你坐在床边，把它放在腿上。空格键中间那道亮痕还在。</p>",
  options:s=>[
    option("找人把它修好","心态+2；留下这把键盘",()=>{gain(s,"MEN",2,"story");log(s,"story","你花了三十块钱，缝好了。")}),
    option("把它收进柜子最深处的箱子","家庭回忆+5，但再也不会用了",()=>{change(s,"family",5);log(s,"story","你把它放进了箱底。")})
  ]
},
{
  id:"pro_lin_pregnant_b",
  phase:["pro"],once:true,condition:s=>s.flags.married===true,
  title:"两条杠",
  portrait:"assets/chen-anan.webp",
  body:"<p>安安把验孕棒放在茶几上，等你回来。你看了一眼，坐下了。她看着你：<span class='dialogue'>“你要是没准备好，我们可以再谈谈。”</span></p><p>她的声音很平静，像在说一件别人的事。但你知道她不是不在乎。</p>",
  options:s=>[
    option("蹲下来，把手放在她肚子上","感情+15，家庭+10；确定成为父亲",()=>{changeLove(s,15);change(s,"family",10);s.flags.father=true;log(s,"good","她握住了你的手腕。")}),
    option("说‘让我想一想，下周再聊’","感情-5，家庭-5",()=>{changeLove(s,-5);change(s,"family",-5);log(s,"story","她轻轻点了点头，把验孕棒收进了抽屉。")})
  ]
},
{
  id:"pro_injury_comeback",
  phase:["pro"],once:true,condition:s=>s.flags.serious_injury&&!(s.injury.months>0),
  title:"复出前的最后一趟训练",
  portrait:"assets/player.webp",
  body:"<p>康复后第一次上机。你坐下来把手放在键盘上，手腕有点抖。不是怕，是太久没这样握过了。键帽的手感让你想起很多东西。</p><p>训练赛开始的提示音响了。</p>",
  options:s=>[
    option("深呼吸，第一个踏进赛场","心态+5；正式复出",()=>{gain(s,"MEN",5,"story");log(s,"story","你重新坐回那个位置。一切都没变。")}),
    option("先打两把匹配找手感","谨慎，状态+3",()=>{change(s,"form",3);log(s,"story","你慢慢进入了节奏。")})
  ]
},
{
  id:"pro_worldcup_qualified_b",
  phase:["pro"],once:true,condition:s=>s.flags.worldcup_qualified===true,
  title:"出线之夜·休息室",
  portrait:"assets/player.webp",
  body:"<p>水晶炸了。你们赢了。休息室成了疯子集中营。有人把冰桶扣在教练头上，有人在哭。你靠在自己的柜门上，低着头，大口喘气。</p><p>你的手机亮了——你爸的短信：<span class='dialogue'>“打得好。”</span></p><p>就三个字。</p>",
  options:s=>[
    option("拨回去","家庭+10，情感高潮",()=>{change(s,"family",10);log(s,"good","你爸没接。你妈说他在客厅抹眼泪。")}),
    option("回一条：还不够","心态+3，保持饥饿",()=>{gain(s,"MEN",3,"story");log(s,"story","你又拿起战术手册翻了两页，才加入庆祝。")})
  ]
},
{
  id:"pro_lin_wedding",
  phase:["pro"],once:true,condition:s=>s.flags.married===true&&s.flags.wedding_done===undefined,
  title:"把婚礼定在休赛期",
  portrait:"assets/chen-anan.webp",
  body:"<p>安安在电话里说：<span class='dialogue'>“婚纱店说那天档期空着。你要能请假，就定那天。”</span></p><p>你打开手机日历——那天正好有一场热手赛邀请，对手是韩国战队。</p>",
  options:s=>[
    option("推掉热手赛","婚礼如期举行，感情+20",()=>{changeLove(s,20);s.flags.wedding_done=true;log(s,"good","她穿着婚纱等你。你差点迟到。")}),
    option("推迟婚礼，去打比赛","感情-15，职业态度+5",()=>{changeLove(s,-15);gain(s,"MEN",5,"story");s.flags.wedding_done=true;log(s,"bad","你在酒店大堂给她打了一个很长的电话。")})
  ]
},
{
  id:"pro_retirement_decision",
  phase:["pro"],once:true,condition:s=>ageInfo(s).age>=34,
  title:"最后一场主场比赛",
  portrait:"assets/player.webp",
  body:"<p>战队为你办了一个简短的仪式——最后一场主场比赛，赛前给你送了一件签满名字的队服。观众席上有人举着你刚进一队时的照片。那一年你十八岁，瘦得像根竹竿。</p><p>你绕着舞台走了一圈，听到很多人的声音。</p>",
  options:s=>[
    option("在赛场中央跪下，亲吻键盘","仪式感，心态+5",()=>{gain(s,"MEN",5,"story");log(s,"story","全场起立鼓掌。你站起来的时候，眼眶是红的。")}),
    option("绕场一周，把护腕扔上观众席","与粉丝告别，家庭+5",()=>{change(s,"family",5);log(s,"story","一个小孩抢到了护腕，举着它尖叫。")})
  ]
},
{
  id:"pro_mentor_death",
  phase:["pro"],once:true,
  title:"周骁的电话没人接",
  portrait:"assets/coach-zhou.webp",
  body:"<p>你打了三次周骁的电话，没人接。最后是他儿子回的消息：<span class='dialogue'>“我爸昨天走了，心梗。他手机里有你的未接来电，我替他回了。”</span></p><p>你坐在车里，没有熄火。</p>",
  options:s=>[
    option("参加葬礼，站最后一排","情感+10，正式告别",()=>{change(s,"family",10);log(s,"story","你放了一朵白花在墓碑前。风很大。")}),
    option("自己打一场比赛纪念他","心态+5，孤独的告别",()=>{gain(s,"MEN",5,"story");log(s,"story","你一个人在训练室打了两个小时。")})
  ]
},
{
  id:"pro_father_pass_away",
  phase:["pro"],once:true,condition:s=>s.family<=20&&s.flags.father_alive,
  title:"电话在凌晨三点响",
  portrait:"assets/father.webp",
  body:"<p>凌晨三点的电话从不带来好消息。你妈在电话那头只说了一句：<span class='dialogue'>“儿，你爸走了。”</span></p><p>然后她挂了。你听着忙音，躺了很久才起来订票。</p><p>衣柜最上层，那把旧键盘还在。</p>",
  options:s=>[
    option("带那把键盘回家参加葬礼","家庭+20；关系闭环",()=>{change(s,"family",20);s.flags.father_alive=false;s.flags.football_back_home=true;log(s,"story","你把那把旧键盘放在他旁边。一起带去的还有他后来买的那把。")}),
    option("把它留在基地，继续训练","心态+8；回避性处理",()=>{gain(s,"MEN",8,"story");s.flags.father_alive=false;log(s,"story","你那天练到所有灯都灭掉。")})
  ]
},
{
  id:"pro_father_pass_b",
  phase:["pro"],once:true,condition:s=>s.family>20&&s.flags.father_alive,
  title:"同一个电话",
  portrait:"assets/father.webp",
  body:"<p>凌晨三点的电话。你妈的声音比你想的平静：<span class='dialogue'>“你爸让我别吵你比赛。但他走了四个小时了，我想你应该知道。”</span></p><p>你下周有季后赛。</p>",
  options:s=>[
    option("请假回家处理丧事","家庭+15，缺席一场",()=>{change(s,"family",15);s.flags.father_alive=false;sufferInjury(s,1);log(s,"story","你跪在灵堂前，一句话都说不出来。")}),
    option("打完季后赛再回去","心态+10；但家庭永久受损",()=>{gain(s,"MEN",10,"story");s.flags.father_alive=false;change(s,"family",-5);log(s,"story","你拿到了那个人头，没有做任何庆祝动作。赛后你对着镜头说：爸，这是给你的。")})
  ]
},
{
  id:"pro_legend_ending",
  phase:["pro"],once:true,condition:s=>s.fame>=95&&s.flags.worldcup_qualified,
  title:"年度最佳选手之夜",
  portrait:"assets/player.webp",
  body:"<p>你坐在年度颁奖礼的台下。主持人念出你的名字时，你脑子里一片空白。走上台的路很长，大约十五米。你想起那把旧键盘，想起重庆的雨，想起周骁，想起你爸的夜班费。</p><p>奖杯很重。</p>",
  options:s=>[
    option("带着那把旧键盘上台","情感闭环，人气+5",()=>{change(s,"fame",5);log(s,"good","你把那把旧键盘从包里拿出来，举过奖杯。全场起立。")}),
    option("把奖杯献给父亲","家庭+10，情感完成",()=>{change(s,"family",10);log(s,"good","你说：这是我爸的奖杯。")})
  ]
},
{
  id:"pro_silent_ending",
  phase:["pro"],once:true,condition:s=>s.fame<=30&&ageInfo(s).age>=30,
  title:"没有掌声的夜晚",
  portrait:"assets/player.webp",
  body:"<p>又一场替补位上度过的比赛。你收拾休息室柜子的时候，发现角落里有一只遗落的旧护腿板——不记得是谁的了。你把东西装进塑料袋，从侧门走出去。</p><p>没有记者。没有人等你。</p>",
  options:s=>[
    option("给青训队打个电话，问问带队的事","心态+3；开始想退路",()=>{gain(s,"MEN",3,"story");log(s,"story","对面说：随时欢迎你回来。")}),
    option("回家给安安做顿饭","状态+3，家庭+5",()=>{change(s,"form",3);change(s,"family",5);log(s,"story","很久没这么早回家了。")})
  ]
}
,
// ===== 新角色：刘队（队长）与苏晚（赞助商千金）=====
{
  id:"pro_captain_liu",
  phase:["firstteam","pro"],once:true,
  title:"队长把你留了下来",
  portrait:"assets/leader-liu.webp",
  body:"<p>训练结束，所有人都进了休息室，只有刘队叫住你。他是这支队的队长，打了十二年，膝盖上两道疤。<span class='dialogue'>“你有天赋，但你在语音里太软。”</span>他把耳机推到桌子中间，<span class='dialogue'>“这一行，说不出话的人先被淘汰。”</span></p><p>他没有骂你，语气甚至很平。但你听得出来，他是在给你留一条路。</p>",
  options:s=>[
    option("留下来跟他加练","体力+1，教练信任+5；精力-8",()=>{gain(s,"END",1,"story");change(s,"coachFavor",5);change(s,"fitness",-8);log(s,"story","刘队陪你练到天黑，一句多余的话都没有。")}),
    option("说自己有自己的打法","心态+1；刘队没再多说",()=>{gain(s,"MEN",1,"story");log(s,"story","他点点头，转身走了。你分不清那是尊重还是失望。")})
  ]
},
{
  id:"pro_captain_liu_armband",
  phase:["pro"],once:true,condition:s=>s.fame>=65&&!s.flags.captain,
  title:"刘队把队长交给你",
  portrait:"assets/leader-liu.webp",
  body:"<p>刘队要退役了。最后一次队内会议，他当着全队把队长的位置让了出来，走到你面前。<span class='dialogue'>“别学我，我把自己打废了才懂事。”</span>他把自己那份 BP 权限表塞进你手里，<span class='dialogue'>“这支队，以后看你的。”</span></p><p>休息室很安静。所有人都在看你。</p>",
  options:s=>[
    option("郑重接过","成为队长；人气+10，心态+2",()=>{s.flags.captain=true;change(s,"fame",10);gain(s,"MEN",2,"story");log(s,"good","你接下了队长。刘队拍了拍你的后脑勺。")}),
    option("说自己还不够格","成为队长；人气+3",()=>{change(s,"fame",3);s.flags.captain=true;log(s,"story","他说：不够格也得扛。没人天生够格。")})
  ]
},
{
  id:"pro_qianjin_meet",
  phase:["pro"],once:true,notMarried:true,condition:s=>s.fame>=50,
  title:"赞助商晚宴上的那位小姐",
  portrait:"assets/qianjin.webp",
  body:"<p>战队赞助商的晚宴。你穿着不太合身的西装站在角落，一个女孩端着香槟走过来。<span class='dialogue'>“你就是那个从来不笑的选手？”</span>她是赞助商的女儿，苏晚，商学院刚毕业，说话像在谈一桩生意。</p><p>临走她递给你一张名片，背面是一个私人号码。<span class='dialogue'>“我爸的钱，能让你少走十年弯路。有兴趣，就打给我。”</span></p>",
  options:s=>[
    option("客气地收下，回头再说","人气+3；留了个念想",()=>{change(s,"fame",3);s.flags.met_suwan=true;log(s,"story","你把名片收进内袋，没有承诺什么。")}),
    option("说自己习惯自己走","心态+2；她挑了下眉",()=>{gain(s,"MEN",2,"story");s.flags.met_suwan=true;log(s,"story","苏晚笑了：“有意思。”她转身汇入人群。")})
  ]
},
{
  id:"pro_qianjin_choice",
  phase:["pro"],once:true,notMarried:true,condition:s=>s.flags.met_suwan&&["恋人","异地"].includes(s.relationship.status),
  title:"两条路，一条捷径",
  portrait:"assets/qianjin.webp",
  body:"<p>苏晚约你在江边的会所见面。她把一份资源摊在桌上：顶级康复团队、海外战队的引荐、现成的代言合约。<span class='dialogue'>“跟着我，这些都是现成的。”</span>她顿了一下，看着你，<span class='dialogue'>“我要的也不多。”</span></p><p>手机在口袋里震了一下，是安安：<span class='dialogue'>“今天训练累不累？”</span>两条信息，两种人生，摆在同一张桌上。</p>",
  options:s=>[
    option("接过资源，和苏晚走近","资金+60万，人气+5；安安感情-25",()=>{addMoney(s,60);change(s,"fame",5);changeLove(s,-25);s.flags.with_suwan=true;log(s,"bad","你回了苏晚的消息，没有回安安的那条。")},"danger"),
    option("把名片还回去，回安安的消息","感情+15，心态+2；错过那条捷径",()=>{changeLove(s,15);gain(s,"MEN",2,"story");log(s,"story","你站起来说谢谢，然后给安安打电话：我这就回去。")})
  ]
}
];

function eventEligible(e,s){const a=ageInfo(s).age,p=phaseOf(s);return(!e.phase||e.phase.includes(p))&&(!e.minAge||a>=e.minAge)&&(!e.maxAge||a<=e.maxAge)&&(!e.maxMoney||(s.money||0)<e.maxMoney)&&(!e.minMoney||(s.money||0)>=e.minMoney)&&(!e.notMarried||!(s.flags&&s.flags.married))&&(!e.requireMarried||(s.flags&&s.flags.married))&&(!e.condition||e.condition(s))}
function chooseRandomEvent(s,rng=Math.random){let pool=EVENTS.filter(e=>eventEligible(e,s)&&!s.usedEvents.includes(e.id)&&!s.recentEvents.includes(e.id));if(!pool.length){s.usedEvents=s.usedEvents.filter(id=>{const ev=EVENTS.find(x=>x.id===id);return !ev||!eventEligible(ev,s)||ev.once});pool=EVENTS.filter(e=>eventEligible(e,s)&&!s.usedEvents.includes(e.id)&&!s.recentEvents.includes(e.id))}if(!pool.length)return null;const weighted=[];pool.forEach(e=>{const n=Math.max(1,Math.round((e.weight||1)*3));for(let i=0;i<n;i++)weighted.push(e)});const e=weighted[Math.floor(rng()*weighted.length)];s.usedEvents.push(e.id);s.recentEvents=[e.id,...s.recentEvents].slice(0,5);return e}

const STORY_BEATS={
  6:s=>({title:"基地门口的两个人",portrait:"assets/chen-anan.webp",body:`<p>那个夏天你第一次跟一队打训练赛。结束的时候天已经黑透，你背着包往门口走，远远看见基地门口站着两个人。</p><p>安安抱着一个保温杯，旁边站着周骁。周骁先看见你，朝你抬了抬下巴：<span class="dialogue">“你妹等你半天了。”</span></p><p>安安没理他，把保温杯递过来：<span class="dialogue">“绿豆汤，你妈让我带的。”</span>你接过来，烫的。周骁在旁边笑了一声：<span class="dialogue">“我站这儿八分钟了，她一句话没跟我说。”</span></p><p>你拧开盖子喝了一口，安安低下头，发绳松了，她重新扎。三个人站在路灯底下，谁也没说一起走。</p>`,options:[
    option("答应每周留一个晚上给她","感情+12；每月第一次训练收益略降",()=>{changeLove(s,12);s.flags.weeklyPromise=true}),
    option("告诉她，现在不能做保证","心态+1；感情-8，但没有空头承诺",()=>{gain(s,"MEN",1,"will");changeLove(s,-8)})]}),
  12:s=>({title:"父亲第一次承认他也害怕",portrait:"assets/father.webp",body:`<p>你们坐在医院走廊的塑料椅上。你爸刚拿到体检报告，没给你看，叠好塞进裤兜。你问他怎么样，他说<span class="dialogue">“没事，老毛病。”</span></p><p>沉默了一会儿，他突然开口：<span class="dialogue">“你打职业那会儿，我老怕你受伤。后来怕你打不出来。现在……”</span>他顿了一下，手指在膝盖上反复搓，<span class="dialogue">“怕你看不起我。”</span></p><p>你没接话。走廊尽头的电视在播夜场集锦，声音开得很小。他又补了一句：<span class="dialogue">“我这辈子没做成什么事。你不一样。”</span></p>`,options:[
    option("把下一场的门票塞进他口袋","家庭+12，状态+3",()=>{change(s,"family",12);change(s,"form",3)}),
    option("请他少加班，比赛以后还有","家庭+7；父亲疲劳风险下降",()=>{change(s,"family",7);s.risks.familyFatigue=Math.max(0,(s.risks.familyFatigue||0)-12)})]}),
  18:s=>({title:"周年约会撞上邀请赛",portrait:"assets/chen-anan.webp",body:`<p>你们约好了那天去吃那家她提了半年的酸菜鱼。出发前两小时，教练临时通知：晚上七点，邀请赛，首发。</p><p>你给她发消息，她回得很快：<span class="dialogue">“几场？我改签位子。”</span>你说那家店很难排。她说她已经排过一次了，座位能留到八点。</p><p>你打完上一局赶过去的时候，她面前摆了两副碗筷，鱼片凉了，上面凝了一层白色的油。她把火重新打开：<span class="dialogue">“还能吃，你别站门口。”</span></p><p>你没有解释比赛。她没有问输赢。</p>`,options:[
    option("比赛后连夜去见她","人气+8，精力-12；感情+8",()=>{change(s,"fame",8);change(s,"fitness",-12);changeLove(s,8)}),
    option("放弃邀请赛，陪她过完这天","感情+16；人气-10，教练信任-5",()=>{changeLove(s,16);change(s,"fame",-10);change(s,"coachFavor",-5)})]}),
  30:s=>phaseOf(s)==="overseas"?({title:"隔着时差的晚安",portrait:"assets/chen-anan.webp",body:`<p>你这边下午三点，她那边凌晨一点。视频接通的时候她整个人埋在枕头里，只露半张脸。她说没事，就是手机开着睡，万一你那边想说话，她能听见。</p><p>你问她最近累不累，她说月考又没考好，卷子还没订正完。然后她笑了一下，眼睛还闭着：<span class="dialogue">“但比你好一点。起码我不用倒着时差打职业。”</span></p><p>你让她挂电话睡觉。她说：<span class="dialogue">“你先挂。”</span>你挂了，过一会儿又发了一条：晚安。</p><p>她没有回。第二天早上你看到一条消息，时间戳是凌晨三点——她也回了晚安。</p>`,options:[option("认真跟她说说今天","感情+8，状态+3；睡得更晚，精力-4",()=>{changeLove(s,8);change(s,"form",3);change(s,"fitness",-4)}),option("太累了，明天再回","状态+4；感情-6",()=>{change(s,"form",4);changeLove(s,-6)})]})
  :({title:"第一份职业工资",portrait:"assets/father.webp",body:`<p>工资到账那天你站在ATM机前看了三遍数字。取了一万，信封分两叠。</p><p>你爸收到钱没有回消息。晚上你回家，发现桌上多了一把新锁——你那间卧室的门锁早就坏了，他修了好几年都没顾上。</p><p>安安在楼梯口等你，问你领到工资是什么感觉。你想了想说：<span class="dialogue">“终于能请你吃那家酸菜鱼了。”</span>她没笑，低下头，过了半天才说：<span class="dialogue">“你不用急着请我。你先把自己稳住。”</span></p><p>她把那个“你”字咬得很轻，像在说一件很容易碎的东西。</p>`,options:[option("拿出一半给父母","家庭+14；现金-8万",()=>{change(s,"family",14);addMoney(s,-8)}),option("先建立康复与学习账户","精力+8，语言+6，心态+0.4；家庭+4",()=>{change(s,"fitness",8);change(s,"language",6);gain(s,"MEN",.4,"will");change(s,"family",4)})]}),
  36:s=>phaseOf(s)==="campus"?({title:"观众席没有职业合同，仍然有她",portrait:"assets/chen-anan.webp",body:`<p>你没拿到职业合同的那天，学校联赛的观众席上只坐了不到两百人。你打完90分钟，0比0，没有人注意，没有镜头。你坐在休息室里没出来，直到保洁阿姨来关灯。</p><p>安安站在门口，手上拎着一个塑料袋。她蹲下来，把袋子打开——一碗绿豆汤，还是烫的。你说：<span class="dialogue">“我没签上。”</span></p><p>她说：<span class="dialogue">“我看见你打了。最后那个拦截，你滑出去的时候根本没想会不会受伤。”</span></p><p>你端起碗喝了一口。她坐在你旁边，没有说“下次一定行”，没有说“你已经很好了”。她只是坐在那儿，等你喝完。</p>`,options:[option("重新冲击职业试训","人气+15，感情+8；精力-10",()=>{change(s,"fame",15);changeLove(s,8);change(s,"fitness",-10)}),option("把心态与电竞都走完","心态+1，感情+12；职业成长变慢",()=>{gain(s,"MEN",1,"will");changeLove(s,12)})]})
  :({title:"那条没有发出去的消息",portrait:"assets/chen-anan.webp",body:`<p>你签了职业合同那天晚上，手机里翻到安安的对话框。上一次聊天是四个月前，她生日你发了一句“生日快乐”，她回了“谢谢”。</p><p>光标在输入框里闪了很久。你想告诉她你签了，想问她最近怎么样，想说那句“基地门口面还有人吗”。最后你打了一行字——“今天签合同了。”删掉。又打——“好久没联系了。”删掉。</p><p>你把手机锁屏，屏幕黑掉之前，你看见对话框最底下是她半年前发来的最后一条消息：<span class="dialogue">“我准备高考了，你也加油。”</span></p><p>你没有回那条消息。她也没有再发过。</p>`,options:[option("把真实压力说出来","感情+12，状态+6；媒体活动取消一次",()=>{changeLove(s,12);change(s,"form",6);change(s,"fame",-2)}),option("把手机扣下，第二天继续训练","教练信任+5；感情-10，心态+1",()=>{change(s,"coachFavor",5);changeLove(s,-10);gain(s,"MEN",1,"pressure")})]}),
  42:s=>({title:"父亲病床边的终场",portrait:"assets/father.webp",body:`<p>你赶到病房的时候，你爸刚做完一轮透析。他闭着眼，脸上只剩一层皮贴着骨头。你坐在床边，不知道该说什么。</p><p>沉默了很久，他突然开口，声音哑得几乎听不见：<span class="dialogue">“今天……有比赛？”</span>你说推迟了。他摇了摇头：<span class="dialogue">“别推。我这一辈子，就是推得太多了。”</span></p><p>他转过头看着你，目光浑浊，但焦距是准的：<span class="dialogue">“上场去。我等你回来再说。”</span></p><p>你没有走，一直坐到护士来换药。你走到门口时他好像睡着了，你听见他在背后说了一句很轻的话——<span class="dialogue">“打给爸看。”</span></p>`,options:[option("承担治疗，拒绝灰色资金","现金-18万，家庭+15；心态+2",()=>{addMoney(s,-18);change(s,"family",15);gain(s,"MEN",2,"will")}),option("让父母接受保险与社会援助","家庭+8；人气-3",()=>{change(s,"family",8);change(s,"fame",-3)})]}),
  48:s=>({title:"18岁，转会市场开放",portrait:"assets/coach-zhou.webp",body:`周骁把你14岁时的训练表还给你。上面密密麻麻都是红圈。<span class="dialogue">“从今天起，没人再拿年轻当借口。想去更好的战队，就拿比赛说话。”</span>`,options:[option("把训练表折好收进包里","心态+2，教练信任+8",()=>{gain(s,"MEN",2,"will");change(s,"coachFavor",8)}),option("问他：我离最好的选手还差什么","操作+1，沟通+1；状态-2",()=>{gain(s,"MEC",1,"finish");gain(s,"COM",1,"vision");change(s,"form",-2)})]})
};

function loveSupport(s){if(!["恋人","异地"].includes(s.relationship.status))return 0;const l=s.relationship.love;return l>=85?7:l>=65?5:l>=45?3:l>=25?1:0}
/* 家庭同样只走抬高基线这一条路。33个事件已经在写 family，接上基线就等于白捡——
   但绝不能写成每月固定 +N：form 每月回归 22%，那会把均衡点顶高 N/0.22≈4.5N。 */
function familySupport(s){const f=s.family;return f>=90?4:f>=70?2:f>=50?1:f>=30?0:-3}
/* ========== 系列赛比分归一 ==========
   泊松给出的是「这场谁打得更好」的强度，但记分牌上只能出现合法的局分：
   BO3 是 2-0 / 2-1，BO5 是 3-0 / 3-1 / 3-2，而且永远有胜方。
   所有产出 gf/ga 的地方都必须过一次这里，否则日程页会出现 4-4 这种不存在的比分。 */
function toSeries(gf,ga,rng=Math.random,bestOf=3){
  const need=Math.ceil((bestOf+1)/2);
  if(gf===ga){if(rng()<.5)gf++;else ga++}
  const loser=Math.min(Math.min(gf,ga),need-1);
  return gf>ga?{gf:need,ga:loser}:{gf:loser,ga:need};
}
function poisson(lambda,rng=Math.random){let l=Math.exp(-Math.max(.08,lambda)),p=1,k=0;do{k++;p*=rng()}while(p>l&&k<9);return k-1}
function rndFloat(rng,min,max){return min+rng()*(max-min)}
function opponentPool(s){const c=currentClub(s);if(c.league==="LCK")return LCK_TEAMS.filter(x=>x.name!==c.name);if(s.club.league==="韩国青训")return LCK_TEAMS.filter(x=>!s.club.name.includes(x.name)).map(x=>({...x,name:`${x.name} 青训队`,strength:x.strength-11,league:"韩国青训"}));if(s.club.league==="LDL")return LPL_TEAMS.filter(x=>!s.club.name.includes(x.name)).map(x=>({...x,name:`${x.name}.D`,strength:x.strength-10,league:"LDL"}));if(s.club.league==="高校联赛")return CAMPUS_TEAMS.filter(x=>x.name!==s.club.name);return LPL_TEAMS.filter(x=>x.name!==c.name)}
/* 时间线文案分四档：goal=真的进了，assist=真的做成了助攻，near=这一下做成了但没换来比分，fail=没做成。
   判定成功和转化成比分是两次掷骰，"成功"远多于"击杀"——near 这一档就是给它们的，
   少了它就会出现比分没动、简报却在描述击杀的矛盾。缺档时回落到 near：
   宁可把一次好操作说小，也不能凭空报一个记分牌上没有的击杀。 */
const MATCH_ACTION_LINES={
  dribble:{
    assist:["你贴着墙走位绕开技能，反手一个控制交出去，队友补上收掉人头。","你在河道阴影里绕了半圈，从对面视野盲区切进去，队友跟上完成击杀。"],
    near:["你连着躲掉两个关键技能切进后排，但对面辅助的护盾比你的伤害快半秒。","你成功切进去了，人也留下了，只是最后那一下被交了净化。"],
    fail:["你想从侧翼绕，位置刚露出来就被抓住了。","第一个技能空了，后面的连招全部失去意义。"]
  },
  finish:{
    goal:["你把伤害算到了个位数，最后一下平A收掉！","对面残血想撤，你交了闪现追上去补掉！"],
    near:["伤害够了，但对面交了保命，人从你手里溜了。","你打出了这套连招该有的伤害，队友的补刀慢了一步。"],
    fail:["你交出了所有技能，最后一下被格挡。","你算错了他身上还有一层护盾，人没死，你死了。"]
  },
  header:{
    goal:["你在对面开团前先手交了控制，一波五进四！","你顶着塔的伤害强开，队友跟得极快，团战直接结束。"],
    near:["你的先手很干净，队友的输出没跟上，人跑了。","你控住了两个人，可惜自己的血量也见底了。"],
    fail:["你想强开，但对面已经在原地等你了。","开团的角度不对，只控到了对面辅助。"]
  },
  setpiece:{
    goal:["你在龙坑外提前布好视野，抢龙那一下惩戒稳稳落地！","眼位铺满了整个大龙区，对面进来的瞬间你们就知道了。"],
    near:["视野做得很好，你们看清了对面的动作，但节奏没换成资源。","龙抢下来了，你却在撤退时被留下了。"],
    fail:["视野被排掉了，你们进龙坑的时候是瞎的。","惩戒差了两百伤害，龙没了。"]
  },
  pass:{
    assist:["你在语音里报出对面打野的位置，队友提前撤了，反手抓死追击的中单。","你叫停了那波不该打的团，转头去拿了资源，队友补掉了防守方。"],
    near:["你的指挥是对的，队伍执行慢了两秒。","你叫了撤退，但有个人没听见。"],
    fail:["你叫了开团，语音里没人回应。","这次报点晚了，队友已经交了闪现。"]
  }
};
function matchActionText(type,outcome){const rows=MATCH_ACTION_LINES[type]||MATCH_ACTION_LINES.finish;return pick(rows[outcome]||rows.near)}

/* ========== 赛前定位：常驻设置，强制三选一，不消耗执行点 ========== */
const MATCH_PLANS=[
  {id:"carry",name:"打输出核心",icon:"◎",desc:"资源往你这里倾斜，你负责把伤害打出来。人头是多了，但团队作用会被削弱。",
   effects:["击杀率↑","助攻率↓","依赖 MEC"]},
  {id:"deep",name:"稳住运营",icon:"▣",desc:"少冒险，多换资源，把局面拖到你熟悉的节奏。评分更稳，但高光会少。",
   effects:["助攻率↑","评分更稳","依赖 COM"]},
  {id:"press",name:"全场压制",icon:"»",desc:"从对面野区开始压。AWA 够高才压得住，全队更容易赢；不够就是白送，还掉精力。",
   effects:["依赖 AWA","精力↓↓","手伤↑"]}
];

/* ========== 关键时刻场景库 ==========
   stat=关键属性；risk="safe"|"none"|"bold"；style=命中则加流派经验；
   need=需要的流派二级解锁；on成功/失败的后果由 outcome 字段描述。       */
const MOMENT_RISK={safe:.08,none:0,bold:-.15};
const ATTR_OF={finish:"MEC",dribble:"LAN",header:"END",setpiece:"COM",pass:"COM"};
const MOMENTS=[
  {id:"counter_break",title:"越塔单杀",min:12,max:24,
   body:"第{minute}分钟，对面血量见底但缩在塔下。你的技能刚好都在手上，塔的仇恨值在你身上——这一下要么白给，要么直接把这条路打崩。",
   options:[
     {text:"算好伤害强杀",tip:"成功率稳定，依赖操作",stat:"MEC",risk:"safe",style:"carry",goal:true,up:.35,down:-.2,
      win:"你把塔的攻速和他的回血都算进去了，最后一下平A落地，人头到手，你在塔下留了半格血走出来。",fail:"你少算了一层被动回血。他活着走了，你交了闪现还是死在塔里。"},
     {text:"贴脸绕塔风筝",tip:"成功率低，成功后评分大涨，依赖对线",stat:"LAN",risk:"bold",style:"lane",goal:true,up:.8,down:-.5,
      win:"你绕着塔溜了整整两圈，把仇恨拉给小兵再回身收人。观众席先安静了半秒，然后炸了。",fail:"你想多绕一圈，塔的第三下砸在你身上。你倒在了他前面。"},
     {text:"叫打野来包",tip:"容易成功，可能获得助攻与教练信任",stat:"COM",risk:"safe",style:"call",assist:true,up:.3,down:-.2,favor:2,
      win:"你没有贪，报了个点等打野绕后。两个人一起进，干净利落。",fail:"你叫了人，打野在下路。等他到的时候塔已经把人保回去了。"},
     {text:"压线换血硬吃",tip:"压制Ⅱ · 不看伤害直接上，成功即人头",stat:"REA",risk:"bold",style:"lane",need:"lane",goal:true,up:.9,down:-.45,
      win:"你根本没算伤害，凭手感一路平A追进塔里，在自己倒下之前零点几秒把他带走了。",fail:"你们同归于尽，但先倒下的是你。这条路的兵线也没了。"}]},

  {id:"box_scramble",title:"团战混乱",min:20,max:38,cond:s=>s.matchPlan==="carry"||styleOf(s,"carry")>=1,
   body:"第{minute}分钟，中路开团。屏幕上一片技能特效，谁的血条是谁的已经看不清了。你的大招还在。",
   options:[
     {text:"等一秒再进",tip:"依赖心态，稳但收益小",stat:"MEN",risk:"safe",style:"carry",goal:true,up:.25,down:-.15,
      win:"你没有急着进，等对面把控制交完才切进去，收掉两个残血。",fail:"你等得太久，等你进场的时候队友已经全死了。"},
     {text:"直接放大招",tip:"依赖操作",stat:"MEC",risk:"none",style:"carry",goal:true,up:.6,down:-.3,
      win:"你在混乱里找到了那个角度，大招罩住三个人。不好看，但打赢了。",fail:"大招放出去了，位置偏了半个身位，只擦到一个辅助。"},
     {text:"保后排",tip:"依赖沟通",stat:"COM",risk:"none",style:"call",assist:true,up:.3,down:-.2,
      win:"你把控制交给了扑向自家 AD 的那个人，AD 活下来了，团战赢了。",fail:"你想保人，但那个方向根本不是威胁来的方向。"},
     {text:"强杀后排",tip:"大核Ⅱ · 无视一切直插对面 C 位",stat:"MEC",risk:"bold",style:"carry",need:"carry",goal:true,up:.85,down:-.35,
      win:"你从侧面绕进去，穿过所有人直接落在对面 AD 头上。他没反应过来就没了。",fail:"你冲得太深，四个人的技能同时落在你身上。"}]},

  {id:"wing_duel",title:"对线单挑",min:5,max:16,
   body:"第{minute}分钟，兵线在你这边。对面压得很前，身后是一大片没有视野的野区。",
   options:[
     {text:"稳住补刀",tip:"依赖沟通",stat:"COM",risk:"safe",style:"call",assist:true,up:.3,down:-.2,
      win:"你没有理他，安安静静补完这一波兵，顺手把兵线推给了自家打野做节奏。",fail:"你想稳，结果对面直接跳脸，你交了闪现才跑掉。"},
     {text:"上去换血",tip:"依赖对线，风险高",stat:"LAN",risk:"bold",style:"lane",goal:true,up:.7,down:-.4,
      win:"你连着两次卡他技能后摇上去打，血量差拉开一半，他被迫回家。",fail:"第一个技能空了，换血变成单方面挨打。"},
     {text:"退后拿经验",tip:"依赖心态，稳妥",stat:"MEN",risk:"safe",up:.15,down:-.1,
      win:"你退到塔下安静吃经验，等打野过来。教练在耳机里说了句好。",fail:"你退得太靠后，两波兵进了塔，经济差被拉开。"}]},

  {id:"aerial_duel",title:"大龙团",min:26,max:40,
   body:"第{minute}分钟，大龙 buff 就是这局的结局。两队隔着龙坑站着，谁先动谁可能就输了。",
   options:[
     {text:"先手开团",tip:"依赖精力与站位判断",stat:"END",risk:"none",style:"macro",goal:true,up:.55,down:-.3,
      win:"你从侧翼切进去，一个控制把对面阵型撕开。队友的伤害在同一秒落地。",fail:"你先手了，但队友晚了一秒半。你一个人在龙坑里被五个人围住。"},
     {text:"逼对面先动",tip:"依赖心态，耐得住",stat:"MEN",risk:"safe",style:"macro",up:.2,down:-.12,
      win:"你们就站着不动，站了四十秒。对面辅助耐不住往前踩了一步，团战开始的时机是你们选的。",fail:"你们等得太久，对面拿着龙的视野转头去推了下路。"},
     {text:"布控视野",tip:"运营Ⅱ · 把整个龙区变成你的主场",stat:"AWA",risk:"safe",style:"macro",need:"macro",assist:true,up:.5,down:-.2,favor:3,
      win:"龙坑周围六个眼位全是你插的。对面每一步走到哪，你们都提前两秒知道。这团还没打就赢了。",fail:"你去做视野的时候被抓了。少一个人，这团不用打了。"}]},

  {id:"free_kick",title:"BP 最后一手",min:0,max:0,
   body:"BP 阶段，最后一个蓝色方选人权在你们手上。对面的阵容已经亮完，缺一个前排。教练把选择权交给了你。",
   options:[
     {text:"拿版本答案",tip:"依赖沟通，稳",stat:"COM",risk:"safe",style:"call",assist:true,up:.35,down:-.2,favor:2,
      win:"你要了那个版本最稳的英雄。没有惊喜，但每个人都知道该怎么打。",fail:"版本答案被针对了。对面早就准备好了这一手。"},
     {text:"拿绝活英雄",tip:"依赖操作，成功后评分大涨",stat:"MEC",risk:"bold",style:"carry",goal:true,up:.85,down:-.45,
      win:"你要了那个只有你敢拿的英雄。解说愣了两秒，然后开始翻你的历史战绩。整局都是你的。",fail:"你的绝活被完全克制了。这局你从第一分钟就在挨打。"},
     {text:"英雄池深 · 偷体系",tip:"天赋：英雄池深 · 直接改整套阵容",stat:"COM",risk:"none",style:"call",cond:s=>hasTalent(s,"pool_master"),assist:true,up:.6,down:-.25,
      win:"你在最后十秒改了整套思路。对面的 BP 全部作废，他们的教练在镜头里把笔放下了。",fail:"你改得太晚，五个人的英雄配不到一起去。"}]},

  {id:"hold_up",title:"守家",min:30,max:45,
   body:"第{minute}分钟，经济落后八千。对面推到高地，水晶还剩三分之一。所有人的耳机里都很安静。",
   options:[
     {text:"稳住等对面失误",tip:"依赖心态",stat:"MEN",risk:"safe",style:"macro",up:.25,down:-.15,
      win:"你们一个人都没有出去。第三波兵线的时候对面有个人越了塔——就这一下，局面回来了。",fail:"你们守得很好，但守不住第四波。"},
     {text:"分推找机会",tip:"依赖意识",stat:"AWA",risk:"none",style:"macro",assist:true,up:.4,down:-.25,
      win:"你从侧边偷了两座塔，对面被迫回防。经济差被你一个人拉回了三千。",fail:"你去分推，家里守不住了。"},
     {text:"赌一次开团",tip:"依赖操作，全押",stat:"MEC",risk:"bold",style:"carry",goal:true,up:.8,down:-.5,
      win:"你从水晶后面绕出去先手，三杀。这一波之后，比赛重新开始了。",fail:"你冲出去的那一刻，比赛就结束了。"}]},

  {id:"late_chase",title:"最后一波",min:32,max:48,cond:s=>true,
   body:"第{minute}分钟，双方水晶都只剩一口气。这一波谁赢谁就赢了整局。你的手心是湿的。",
   options:[
     {text:"按训练赛那样打",tip:"依赖心态，稳",stat:"MEN",risk:"safe",style:"macro",up:.3,down:-.2,
      win:"你没有做任何多余的动作，就按训练赛里练了一百遍的那样站位、交技能、后撤。赢了。",fail:"你太稳了，稳到错过了唯一的开团时机。"},
     {text:"全交，一波带走",tip:"依赖操作，孤注一掷",stat:"MEC",risk:"bold",style:"carry",goal:true,up:.9,down:-.5,
      win:"你把所有技能包括闪现全部交了出去，在倒下之前把对面的水晶敲碎。全场起立。",fail:"技能全交完了，对面还剩两个人站着。"}]},

  {id:"defend_lead",title:"领先局的最后十分钟",min:25,max:42,
   body:"第{minute}分钟，你们领先。教练在语音里只说了一句：别送。可越是这种时候，越有人手痒。",
   options:[
     {text:"控资源不打架",tip:"依赖意识",stat:"AWA",risk:"safe",style:"macro",up:.3,down:-.18,favor:3,
      win:"你把每一条小龙、每一波兵线都吃干净，一次架都没打。对面越等越急。",fail:"你们在控资源的时候被抓了一个人，节奏断了。"},
     {text:"叫停手痒的队友",tip:"依赖沟通",stat:"COM",risk:"safe",style:"call",assist:true,up:.25,down:-.15,favor:2,
      win:"你在他交闪现之前那零点五秒把人喊住了。赛后复盘时教练把这段单独拿出来放了一遍。",fail:"你喊了，但语音里三个人在同时说话，没人听见。"},
     {text:"顺势再打一波",tip:"依赖操作，贪一点",stat:"MEC",risk:"bold",style:"carry",goal:true,up:.7,down:-.45,
      win:"你觉得能打，结果真能打。这一波之后比赛提前结束了。",fail:"你贪了。领先的八千经济在九十秒里全没了。"}]},

  {id:"press_trigger",title:"入侵野区",min:2,max:10,cond:s=>s.matchPlan==="press"||styleOf(s,"macro")>=1,
   body:"第{minute}分钟，开局。你们决定不按常规开，五个人直接摸进对面野区。对面的红 buff 还没刷。",
   options:[
     {text:"抢 buff 就撤",tip:"依赖意识",stat:"AWA",risk:"safe",style:"macro",assist:true,up:.35,down:-.2,
      win:"你们抢了 buff 就跑，一个人都没留下。对面打野的整个前期节奏被打乱了。",fail:"对面早有准备，你们进去的时候五个人在等着。"},
     {text:"埋伏打野",tip:"依赖精力与耐心",stat:"END",risk:"none",style:"macro",goal:true,up:.55,down:-.3,
      win:"你在草丛里蹲了四十秒。他一进来就没了。开局一杀。",fail:"你蹲错了草丛。他从另一边过来，还看见了你们所有人。"},
     {text:"直接开团",tip:"依赖操作，开局全押",stat:"MEC",risk:"bold",style:"carry",goal:true,up:.85,down:-.5,
      win:"零级团。你们打赢了。对面的中单在第一波兵线之前就死了两次。",fail:"零级团你们输了。开局就落后两个人头，这局很难打。"}]},

  {id:"through_ball",title:"一句话的分量",min:18,max:34,
   body:"第{minute}分钟，队伍在两个决定之间僵住了：打这波，还是撤。所有人都在等有人拍板。耳机里有五秒钟没有人说话。",
   options:[
     {text:"报点，让队友决定",tip:"依赖沟通，稳",stat:"COM",risk:"safe",style:"call",assist:true,up:.3,down:-.18,
      win:"你没有下命令，只把看到的信息全部报了出来：对面打野在哪、谁交了闪现、还有多久刷龙。剩下的事队友自己就想通了。",fail:"你报的信息太多太快，反而没人接得住。"},
     {text:"直接下开团指令",tip:"指挥Ⅱ · 你说打就打",stat:"COM",risk:"none",style:"call",need:"call",assist:true,up:.6,down:-.3,favor:3,
      win:"你说了一个字：打。五个人同时动了。这是一支队伍最好的样子。",fail:"你说了打，但这波本来就不该打。责任在你身上。"},
     {text:"沉默，自己找机会",tip:"依赖操作，独狼",stat:"MEC",risk:"bold",style:"carry",goal:true,up:.75,down:-.45,
      win:"你没说话，自己绕到侧面切了进去。赢是赢了，赛后没有人夸你。",fail:"你自己进去了，没有人跟。你死在了没有视野的地方。"}]}
];
/* need=流派二级解锁；cond=天赋等额外条件。两道闸都不通过就不显示这个选项。 */
/* BP 阶段这类场景发生在游戏开始之前（min=max=0），标题里写「第0分钟」是错的。
   分钟数只有真的在局内才写。 */
function momentHeadline(slot,m){return slot.minute>0?`第${slot.minute}分钟 · ${m.title}`:m.title}
function momentOptions(s,m){return m.options.filter(o=>(!o.need||styleOf(s,o.need)>=2)&&(!o.cond||o.cond(s)))}
function momentSuccessRate(s,m,o,opp,behind){
  let p=.35+(eff(s,o.stat)-opp)*.008+MOMENT_RISK[o.risk];
  if(hasTalent(s,"box_instinct")&&o.stat==="MEC")p+=.06;
  if(hasTalent(s,"explosive_start")&&(o.stat==="LAN"||o.stat==="REA"))p+=.06;
  if(hasTalent(s,"aerial_king")&&o.stat==="END")p+=.08;
  if(hasTalent(s,"free_kick")&&o.stat==="COM")p+=.1;
  if(hasTalent(s,"football_iq")&&o.stat==="COM")p+=.05;
  if(hasTalent(s,"big_heart")&&behind)p+=.05;
  if(styleOf(s,"carry")>=1&&o.stat==="MEC")p+=.05;
  if(styleOf(s,"lane")>=1&&(m.id==="counter_break"||m.id==="press_trigger"))p+=.06;
  if(styleOf(s,"carry")>=3&&m.id==="late_chase"&&o.stat==="MEC")p+=.08;
  return clamp(p,.15,.85);
}
// 抽两个关键时刻：第一个偏上半场，第二个偏下半场。late_chase/defend_lead 只走强制路径。
function pickMoments(s,rng){
  const pool=MOMENTS.filter(m=>!m.forced&&(!m.cond||m.cond(s)));
  const weighted=m=>m.id==="aerial_duel"&&styleOf(s,"macro")>=1?[m,m]:[m];
  const early=pool.filter(m=>m.min<=70).flatMap(weighted);
  const late=pool.filter(m=>m.max>=55).flatMap(weighted);
  const fallback=MOMENTS.find(m=>m.id==="wing_duel");
  const first=early.length?early[Math.floor(rng()*early.length)]:fallback;
  const lateOpts=late.filter(m=>m.id!==first.id);
  const second=lateOpts.length?lateOpts[Math.floor(rng()*lateOpts.length)]:fallback;
  return [first,second].map((m,i)=>({id:m.id,minute:i===0?Math.round(m.min+rng()*(Math.min(m.max,70)-m.min)):Math.round(Math.max(m.min,55)+rng()*(m.max-Math.max(m.min,55)))}));
}

/* prepareMatch 只产出纯 JSON 数据，不修改 s——这样整个待决状态可以直接存档。 */
function prepareMatch(s,rng=Math.random,opts={}){
  const club=opts.club||currentClub(s),opp=opts.opponent||pick(opponentPool(s));
  const a=ageInfo(s),home=opts.home??rng()>.48,injured=s.injury.months>0||s.suspension>0;
  const plan=opts.plan||s.matchPlan||"carry";
  const starts=!injured&&rng()<startChance(s,{club}),plays=!injured&&(starts||rng()<.74+(hasTalent(s,"super_sub")?.15:0));
  const role=starts?"首发":plays?"替补":"未出场";
  const talentBonus=(hasTalent(s,"big_heart")&&opts.important?4:0)+(hasTalent(s,"home_favorite")&&home?3:0)+(hasTalent(s,"super_sub")&&!starts&&plays?4:0)+(hasTalent(s,"final_master")&&opts.final?5:0);
  const myAtk=atk(s)+talentBonus+rndFloat(rng,-12,12),myDef=def(s);
  let clubEdge=(club.strength-opp.strength)+(home?3:-2);
  if(plays)clubEdge+=(myAtk-club.strength)*.14+(myDef-club.strength)*.06;
  if(plan==="press")clubEdge+=(myDef-55)*.10;
  if(styleOf(s,"call")>=3)clubEdge+=2;
  const myXg=clamp(1.25+clubEdge/18,0.25,3.6),oppXg=clamp(1.12-clubEdge/22,0.25,3.3);
  /* mustDecide 曾经是「淘汰赛才不许平」；现在电竞任何一场都要分出胜负，
     bestOf 只影响记分牌长什么样：常规赛 BO3，季后赛与国际赛 BO5。 */
  let {gf,ga}=toSeries(poisson(myXg,rng),poisson(oppXg,rng),rng,opts.mustDecide?5:3);
  const timeline=[{minute:5,text:home?"主场观众席先把节奏推了起来。":"客场开局，对手试图用高压逼抢制造错误。",kind:"turn"}];
  let goals=0,assists=0,keyWins=0,failures=0;
  const goalBonus=plan==="carry"?.08:plan==="deep"?-.06:0;
  const assistBonus=(plan==="deep"?.1:plan==="carry"?-.1:0)+(styleOf(s,"call")>=1?.08:0);
  if(plays){
    const minuteStart=starts?8:rand(55,68);
    const attempts=Math.max(1,(starts?rand(4,6):rand(2,4))-2);   // 留两个名额给关键时刻
    const types=plan==="carry"?["finish","finish","dribble","finish"]:["dribble","finish","pass","finish"];
    if(hasTalent(s,"aerial_king"))types.push("header","header");else types.push("header");
    if(hasTalent(s,"free_kick")||s.attrs.COM>68)types.push("setpiece");
    for(let i=0;i<attempts;i++){
      const type=types[Math.floor(rng()*types.length)],stat=eff(s,ATTR_OF[type]||"MEC");
      let p=.25+(stat-45)/90+talentBonus/100;
      if(type==="finish"&&hasTalent(s,"box_instinct"))p+=.09;if(type==="header"&&hasTalent(s,"aerial_king"))p+=.13;if(type==="setpiece"&&hasTalent(s,"free_kick"))p+=.16;if(type==="dribble"&&hasTalent(s,"explosive_start"))p+=.08;
      const success=rng()<clamp(p,.16,.88);if(success)keyWins++;else failures++;
      const isGoal=success&&["finish","header","setpiece"].includes(type)&&goals<gf&&rng()<clamp(.38+(eff(s,"MEC")-52)/100+goalBonus,.28,.82);
      const isAssist=success&&["pass","dribble"].includes(type)&&assists+goals<gf&&rng()<clamp(.26+(eff(s,"COM")-45)/150+assistBonus,.18,.63);
      const minute=Math.min(88,Math.round(minuteStart+i*(80-minuteStart)/attempts+rndFloat(rng,0,6)));
      if(isGoal){goals++;timeline.push({minute,text:matchActionText(type,"goal"),kind:"goal"})}
      else if(isAssist){assists++;timeline.push({minute,text:`助攻：${matchActionText(type,"assist")}`,kind:"good"})}
      else timeline.push({minute,text:matchActionText(type,success?"near":"fail"),kind:success?"good":"turn"});
    }
  }else timeline.push({minute:62,text:injured?"你在观众席上观看比赛，康复计划没有允许冒险。":"教练完成最后一次换人，你仍留在替补位。",kind:"bad"});
  let injuryChance=plays?Math.max(.005,(.016+(45-s.fitness)/500+(s.injury.risk||0)/900-(hasTalent(s,"iron_man")?.015:0))*diffOf(s).injury*assetInjuryFactor(s)):0;
  if(plan==="press")injuryChance*=1.6;
  return {opponent:opp.name,oppStrength:opp.strength,club:club.name,league:club.league,home,starts,plays,role,injured,
    clubEdge,gf,ga,goals,assists,keyWins,failures,timeline,plan,assistBonus,
    injuredInMatch:rng()<injuryChance,
    moments:plays?pickMoments(s,rng):[],choices:[],
    month:s.totalMonth,season:a.season,round:(s.seasonStats.matches||0)+1,
    competition:opts.competition||`${club.league}第${(s.seasonStats.matches||0)+1}轮`,
    ability:Math.round(overall(s)),condition:Math.round((s.form+s.fitness)/2),randomShown:Math.round(rndFloat(rng,1,100))};
}

/* 关键时刻结算：由 finishMatch（战队/季后赛）与大赛正赛共用。
   规则的要害是 claimGoal——稳妥选择只是把战队已有的机会转化到你名下，
   只有高风险才能创造 xG 之外的击杀，且每场至多一个 overflow。
   S赛那边绝不能写一套近似版，两套必然漂移。
   传入的 p 会被就地修改并返回。 */
function resolveMoments(s,p,rng=Math.random){
  let ratingDelta=0,boldTotal=0,boldWon=0,classic=false,fitExtra=0,favorExtra=0,overflow=0;
  // 关键时刻的击杀必须挂进战队比分：先认领模型已经算出来的击杀。
  // 只有高风险选择才能创造战队 xG 之外的击杀，每场至多一个——
  // 稳妥选择只是把已有的机会转化掉，不该凭空把比分吹上天。
  const claimGoal=bold=>{if(p.goals<p.gf){p.goals++;return true}if(bold&&overflow<1){overflow++;p.gf++;p.goals++;return true}return false};
  const claimAssist=bold=>{if(p.goals+p.assists<p.gf){p.assists++;return true}if(bold&&overflow<1){overflow++;p.gf++;p.assists++;return true}return false};
  (p.moments||[]).forEach((slot,i)=>{
    const m=MOMENTS.find(x=>x.id===slot.id);if(!m)return;
    const opts=momentOptions(s,m);
    const choiceIdx=p.choices[i];
    const o=opts[choiceIdx]!==undefined?opts[choiceIdx]:opts.find(x=>x.risk==="safe")||opts[0];
    const behind=p.gf<p.ga;
    const ok=rng()<momentSuccessRate(s,m,o,p.oppStrength,behind);
    if(o.risk==="bold")boldTotal++;
    if(ok){
      boldWon+=o.risk==="bold"?1:0;p.keyWins++;
      let up=o.up,denied=false;
      const bold=o.risk==="bold";
      if(o.goal){
        if(claimGoal(bold)){
          if(styleOf(s,"carry")>=3&&m.id==="late_chase"&&o.stat==="MEC")up+=.3;
          if(styleOf(s,"lane")>=3&&o.stat==="LAN"&&rng()<.12&&claimGoal(bold))
            p.timeline.push({minute:Math.min(89,slot.minute+2),text:"这波之后你顺势又收了一个——双杀。",kind:"goal"});
        }else denied=true;
      }else if(o.assist&&!claimAssist(bold))denied=true;
      if(!denied&&(o.teamGoal||(styleOf(s,"macro")>=3&&o.style==="macro"))&&overflow<1&&rng()<.45){
        overflow++;p.gf++;
        p.timeline.push({minute:Math.min(89,slot.minute+1),text:"你创造的机会被队友转化成了击杀。",kind:"goal"});
      }
      if(o.classic&&!denied)classic=true;
      if(denied)up*=.5;
      ratingDelta+=up;favorExtra+=o.favor||0;fitExtra+=(o.fitGain||0)-(o.fitCost||0);
      if(o.style)addStyleExp(s,o.style,5);
      p.timeline.push({minute:slot.minute,
        text:denied?`【${o.text}】${o.goal?"你做出来了，但对面交了保命，比分没有变化。":"你把机会做到位了，队友却没能把它转化成击杀。"}`:`【${o.text}】${o.win}`,
        kind:denied?"turn":o.goal?"goal":"good"});
    }else{
      p.failures++;
      ratingDelta+=o.down*(hasTalent(s,"pressure_proof")?.5:1);
      fitExtra-=(o.fitCost||0)+3;
      p.timeline.push({minute:slot.minute,text:`【${o.text}】${o.fail}`,kind:"turn"});
      if(o.risk==="bold"&&rng()<.35){p.ga++;
        p.timeline.push({minute:Math.min(89,slot.minute+2),text:"这波之后对面立刻反打，我们的阵型还没重整——他们扳回一局。",kind:"bad"})}
    }
  });
  p.ratingDelta=ratingDelta;p.boldTotal=boldTotal;p.boldWon=boldWon;
  p.momentClassic=classic;p.fitExtra=fitExtra;p.favorExtra=favorExtra;
  return p;
}

/* finishMatch 结算已作答的关键时刻，未作答的按稳妥选项自动判定。同样不修改 s。 */
function finishMatch(s,pending,rng=Math.random){
  const p={...pending,timeline:pending.timeline.slice()};
  resolveMoments(s,p,rng);
  const ratingDelta=p.ratingDelta,boldTotal=p.boldTotal,boldWon=p.boldWon;
  let classic=p.momentClassic;
  const fitExtra=p.fitExtra,favorExtra=p.favorExtra;
  if(p.injuredInMatch)p.timeline.push({minute:rand(63,87),text:"一次对抗后你没有立刻站起来，队医示意换人。",kind:"bad"});
  p.timeline.push({minute:90,text:`终场：${p.club} ${p.gf}-${p.ga} ${p.opponent}。`,kind:p.gf>p.ga?"goal":p.gf<p.ga?"bad":"turn"});
  p.timeline.sort((x,y)=>x.minute-y.minute);
  const jitter=p.plan==="deep"?rndFloat(rng,-.30,.30):rndFloat(rng,-.48,.48);
  const rating=p.plays?clamp(6.05+p.goals*.92+p.assists*.55+p.keyWins*.11-p.failures*.07+ratingDelta+jitter,4.7,10):0;
  // 经典要稀有才叫经典：单场9分以上，或两次关键时刻都选了高风险且都成功。
  if(rating>=9||(boldTotal>=2&&boldWon===boldTotal))classic=true;
  return {id:`m${Date.now()}${Math.random()}`,month:p.month,season:p.season,round:p.round,competition:p.competition,
    club:p.club,opponent:p.opponent,home:p.home,role:p.role,gf:p.gf,ga:p.ga,goals:p.goals,assists:p.assists,
    rating:Number(rating.toFixed(1)),timeline:p.timeline,injured:p.injuredInMatch,plan:p.plan,
    classic:p.plays&&classic,fitExtra:(p.plan==="press"?-6:0)+fitExtra,favorExtra,
    model:{ability:p.ability,condition:p.condition,random:p.randomShown,clubEdge:Math.round(p.clubEdge)}};
}

// 非交互包装器：国际赛/未出场/测试统计都走这里，签名与返回结构保持不变。
function simulateMatchCore(s,rng=Math.random,opts={}){
  return finishMatch(s,prepareMatch(s,rng,opts),rng);
}

function applyMatch(s,report){
  const pp=hasTalent(s,"pressure_proof")?.5:1;
  s.matches.unshift(report);s.matches=s.matches.slice(0,60);if(report.role==="未出场"){if(!(s.injury.months>0||(s.suspension||0)>0))change(s,"form",Math.round(-1.8*pp));return}
  const c=s.statsCareer,ss=s.seasonStats;c.matches++;ss.matches++;if(report.role==="首发")c.starts++;c.goals+=report.goals;c.assists+=report.assists;ss.goals+=report.goals;ss.assists+=report.assists;ss.ratingTotal+=report.rating;
  // 一局只结算一次状态：胜负和个人表现合并成一笔，别对同一场比赛的 form 连开两枪。
  let dForm;if(report.gf>report.ga){c.wins++;ss.wins++;dForm=5}else if(report.gf===report.ga){c.draws++;dForm=1}else{c.losses++;dForm=Math.round(-4*pp)}
  c.bestRating=Math.max(c.bestRating,report.rating);if(report.goals>=3){c.hatTricks++;unlock("hat_trick")};if(report.goals>0)unlock("first_goal");unlock("debut");if(c.goals>=50)unlock("fifty_goals");if(c.goals>=100)unlock("hundred_goals");if(c.assists>=50)unlock("fifty_assists");
  change(s,"fame",report.goals*1.3+report.assists*.7+(report.rating>=8?2:0));change(s,"fitness",-(hasTalent(s,"engine")?8:12)+(report.fitExtra||0));change(s,"form",dForm+(report.rating>=7?2:Math.round(-1.2*pp)));change(s,"coachFavor",(report.rating>=7.5?4:report.rating<6?-3:1)+(report.favorExtra||0));
  if(report.classic)unlock("classic_match");
  if(report.injured)sufferInjury(s,rand(1,4));
  log(s,report.gf>report.ga?"good":report.gf<report.ga?"bad":"story",`${report.competition}：${report.club} ${report.gf}-${report.ga} ${report.opponent}。你${report.role}，${report.goals}杀${report.assists}助，评分${report.rating||"—"}。`)
}

function routeChoice16(s){
  const d=diffOf(s),o=overall(s),eligibleLocal=o>=63+d.threshold||s.fame>=44+d.threshold,eligibleOverseas=o>=72+d.threshold||(o>=68+d.threshold&&hasTalent(s,"scout_magnet"));
  const options=[];
  if(eligibleLocal)options.push(option("签下CQG 二队合同","留在国内，与安安继续交往；竞争、工资和家庭压力同时开始",()=>setRoute(s,"firstteam")));
  if(eligibleOverseas)options.push(option("接受 T1 青训营邀请","更高平台与成长上限；立即出国，与安安转为异地",()=>setRoute(s,"overseas"),"gold"));
  options.push(option(eligibleLocal?"放弃职业合同，回校园":"接受落选，回到校园","与安安留在一起，学业更稳定；18岁仍可通过校队试训重返职业",()=>setRoute(s,"campus")));
  return{title:eligibleOverseas?"三扇门，只能走进一扇":eligibleLocal?"一纸合同，和另一种生活":"二队名单上没有你的名字",portrait:eligibleOverseas?"assets/chen-anan.webp":"assets/coach-zhou.webp",body:`<p>16岁评估：综合能力 <b>${o}</b>，人气 <b>${Math.round(s.fame)}</b>，教练信任 <b>${Math.round(s.coachFavor)}</b>。${eligibleOverseas?"韩国那边的青训营给出邀请，但要求你搬过去住基地，一年只能回国一次。安安没有哭，只问你是否已经决定。":eligibleLocal?"战队给出一份低薪青训合同。校园与职业的路从今天开始分开。":"周骁说你的成长还没有结束，但战队不能为“也许”保留位置。"}</p><p>你爸没有替你做决定，只在饭桌上说了一句：<span class="dialogue">“自己选。选完别回头。”</span>安安什么也没说，只在你出门时把一包葱油味饼干塞进你书包——你最喜欢的那种。</p>`,options}
}
function setRoute(s,route){s.route=route;s.flags.route16=true;ensureRival(s);if(route==="firstteam"){s.club={name:"CQG",league:"LPL",strength:67};s.salary=4;s.relationship.status="恋人";addMoney(s,5);change(s,"fame",5);log(s,"story","你进了 CQG 二队，与安安留在同一座城市。")}
  if(route==="overseas"){s.club={name:"T1 青训队",league:"韩国青训",strength:74};s.salary=3;s.relationship.status="异地";s.language=clamp(s.language+5);change(s,"fame",8);change(s,"form",-2);log(s,"story","你飞往英格兰的青训营。临行前你和安安约好试试异地，谁也没提“分手”——从此隔着七个小时的时差。")}
  if(route==="campus"){s.club={name:"重庆市第七中学校队",league:"高校联赛",strength:55};s.salary=0;s.relationship.status="恋人";changeLove(s,8);log(s,"story","你回到校园。安安坐在你旁边，但她要求你不要把她当作放弃职业的理由。")}}

function enterProAt18(s){if(s.flags.pro18)return;s.flags.pro18=true;
  if(s.route==="overseas"){const promote=overall(s)>=73+diffOf(s).threshold&&s.language>=35;s.club=promote?{name:"Dplus KIA",league:"LCK",strength:86}:{name:"DRX",league:"LCK",strength:77};s.salary=promote?22:10;s.route="pro";if(s.club.league==="LCK")unlock("premier");log(s,"story",promote?"你拿到了 LCK 一队合同。平台更大，容错更小。":"强队没有给出首发位，DRX 给了你真正的职业舞台。")}
  else if(s.route==="firstteam"){s.route="pro";s.club={name:"CQG",league:"LPL",strength:67};s.salary=7;log(s,"story","18岁，你不再占用青年名额。战队开始用成年人的标准衡量你。")}
  else{const d=diffOf(s),success=overall(s)>=61+d.threshold||s.fame>=93+d.threshold;s.route="pro";s.relationship.status="恋人";
    if(!success&&d.threshold>=5&&overall(s)<54+d.threshold){s.flags.washedOut=true;log(s,"bad","一圈职业试训下来，没有一家队愿意签你。赛场这条路，到此为止。");return}
    const club=success?{name:"CQG",league:"LPL",strength:67}:{name:"RA",league:"LPL",strength:72};s.club=club;s.salary=success?6:4;
    enqueueDecision({title:"18岁 · 迟到两年的试训",portrait:"assets/coach-zhou.webp",body:`<p>你两年没摸过职业训练的节奏了。高校联赛的强度跟青训完全是两个世界，你自己知道。这封试训邀请是你争取来的——你剪了自己的比赛录像发出去，只有${esc(club.name)}回了一个字：来。</p><p>你背着包走进训练基地。路过一队训练室时，里面在打训练赛，节奏比你习惯的快很多。你停了一步，然后继续走。楼下休息区里，安安和父亲都来了。</p><p>青训组的教练看了你一眼，把手里的名单翻了一页——上面印着十几个试训选手的名字。<span class="dialogue">${success?"“绕了两年，你还是挤了回来。这回，站稳了。”":"“不是最风光的起点，但你终于重新站上了职业赛场。”"}</span></p>`,options:[option("握紧这次机会","职业生涯正式开始",()=>{})]},"18岁 · 重返职业");
    log(s,"story",success?`高校赛打了两年，你在18岁赢得试训并重返${club.name}。`:`一次次试训后，${club.name}给了你一纸轮换合同——队更强，但你只是第六人。你绕远路回到了职业赛场。`)}
  generateOffers(s,2)
}

function generateOffers(s,count=2,upgrade=false){if(ageInfo(s).age<18&&!s.flags.pro18)return[];const o=overall(s),current=currentClub(s);let pool=[...LPL_TEAMS,...LCK_TEAMS].filter(c=>c.name!==current.name);pool=pool.filter(c=>{if(c.league==="LCK"&&o<76+diffOf(s).threshold&&!hasTalent(s,"scout_magnet"))return false;if(upgrade&&c.strength<=current.strength)return false;return Math.abs(c.strength-(o+5))<=18});if(!pool.length)pool=[...LPL_TEAMS].filter(c=>c.name!==current.name);pool=pool.sort(()=>Math.random()-.5).slice(0,count);s.offers=pool.map(c=>({id:`o${Date.now()}${Math.random()}`,club:c.name,league:c.league,strength:c.strength,role:o>=c.strength+2?"核心":o>=c.strength-5?"轮换":"替补竞争",salary:Math.max(8,Math.round((c.strength-55)*1.4+s.fame/8)),fee:Math.max(120,Math.round((o-50)*38+s.fame*8)),months:2}));return s.offers}
function acceptOffer(s,id){const offer=s.offers.find(o=>o.id===id);if(!offer)return;const from=s.club.name;s.club={name:offer.club,league:offer.league,strength:offer.strength};s.salary=offer.salary;s.transfers.unshift({month:s.totalMonth,from,to:offer.club,fee:offer.fee,role:offer.role});const cut=s.agent?s.agent.cut/100:0;addMoney(s,Math.round((offer.salary*.8+offer.fee*.05)*(1-cut)));if(cut)log(s,"story",`经纪人按${s.agent.cut}%抽成，签约金到手打了折。`);s.flags.wantsMove=false;s.offers=[];change(s,"coachFavor",offer.role==="核心"?65-s.coachFavor:50-s.coachFavor);change(s,"fame",offer.league==="LCK"?10:4);if(offer.league==="LCK")unlock("premier");log(s,"story",`转会完成：${from} → ${offer.club}，角色为${offer.role}。`);if(s.route==="pro"&&ageInfo(s).age>=18){makeSeasonGoal(s);if(s.seasonGoal)log(s,"story",`新东家给了新的赛季目标：${s.seasonGoal.text}。`)}}

function nationalSelectionCheck(s){if(s.national.called||ageInfo(s).age<18)return false;const avg=s.seasonStats.matches?s.seasonStats.ratingTotal/s.seasonStats.matches:0;const threshold=(hasTalent(s,"red_shirt")?71:74)+diffOf(s).threshold;if(overall(s)>=threshold&&avg>=6.7+diffOf(s).threshold*.02){s.national.called=true;s.national.adapt=35;unlock("national");log(s,"story","国际赛事名单公布，你的 ID 在上面。父亲把那张截图保存了三次。") ;return true}return false}
function simulateNationalMatch(s,rng=Math.random,worldCup=false,fixed=null){const opp=fixed||pick(INTL_OPPONENTS),player=overall(s),china=70+(player-70)*.45+(s.national.adapt||0)*.05+(hasTalent(s,"red_shirt")?2:0),edge=china-opp.strength+rndFloat(rng,-9,9),ser=toSeries(poisson(clamp(1.1+edge/18,.2,3.2),rng),poisson(clamp(1.15-edge/22,.2,3.1),rng),rng,3),gf=ser.gf,ga=ser.ga,goals=gf>0&&rng()<clamp(.28+(player-65)/85,.2,.72)?Math.min(gf,rng()<.16?2:1):0,assists=gf-goals>0&&rng()<.32?1:0,report={opponent:opp.name,gf,ga,goals,assists,worldCup};s.national.caps++;s.statsCareer.nationalCaps++;s.national.goals+=goals;s.statsCareer.nationalGoals+=goals;if(goals)unlock("national_goal");change(s,"fitness",-12);change(s,"fame",goals*3+(gf>ga?2:0));log(s,gf>ga?"good":gf<ga?"bad":"story",`国际赛事 ${gf}-${ga} ${opp.name}。你拿下${goals}杀${assists}助。`);return report}

function makeSeasonGoal(s){if(ageInfo(s).age<18||s.route!=="pro"){s.seasonGoal=null;return}
  const o=overall(s),club=currentClub(s),roll=Math.random();let goal;
  if(club.tier===3||o<club.strength-4)goal={kind:"survive",target:3,text:`帮${s.club.name}守住联赛排名，赛季末别落进榜尾三名`};
  else if(roll<.5){const t=Math.max(6,Math.round((o-58)/3)+(s.club.league==="LCK"?2:0));goal={kind:"goals",target:t,text:`本赛季至少拿下${t}个人头`}}
  else goal={kind:"rating",target:7,text:"本赛季平均评分不低于7.0"};
  goal.season=ageInfo(s).season;s.seasonGoal=goal;log(s,"story",`教练组给了本赛季目标：${goal.text}。`)}
function goalProgressText(s){const g=s.seasonGoal;if(!g)return"";const ss=s.seasonStats,avg=ss.matches?(ss.ratingTotal/ss.matches).toFixed(1):"—";return g.kind==="goals"?`${g.text}（已拿${ss.goals}杀）`:g.kind==="rating"?`${g.text}（当前${avg}）`:`${g.text}（${leagueRankText(s)||`已赢${ss.wins}场`}）`}
/* 榜尾三名算降级区。这条目标的文案一直写着「别掉进降级区」，
   但判定只看 wins>=6，跟排名毫无关系——现在它第一次名副其实。
   注意：这里不引入真正的升降级机制（那会牵动转会、合同、人气一整串），
   只是让目标判定对得上它自己的文案。 */
function inRelegationZone(s){
  const lg=seasonFinalLeague(s);if(!lg||!lg.teams.length||!lg.played)return false;
  const st=leagueStandings(lg);
  return st.slice(-3).some(x=>x.name===s.club.name);
}
/* 保级目标的进度不再报胜场——判定看的是排名，进度也得报排名，两边说一件事。 */
function leagueRankText(s){
  const lg=s.league;if(!lg||!lg.teams.length||!lg.played)return"";
  const st=leagueStandings(lg),i=st.findIndex(x=>x.name===s.club.name);
  return i<0?"":`当前第${i+1}名`;
}
function evaluateSeasonGoal(s){const g=s.seasonGoal;if(!g)return null;const ss=s.seasonStats,avg=ss.matches?ss.ratingTotal/ss.matches:0;let met=false;
  if(g.kind==="goals")met=ss.goals>=g.target;else if(g.kind==="rating")met=avg>=g.target&&ss.matches>=6;else if(g.kind==="survive")met=!inRelegationZone(s);
  if(met){change(s,"coachFavor",10);change(s,"fame",4);const bonus=Math.round((s.salary||4)*2);addMoney(s,bonus);log(s,"good",`完成赛季目标（${g.text}），拿到 ${bonus} 万奖金，教练更信任你。`)}
  else{s.goalFails=(s.goalFails||0)+1;change(s,"coachFavor",-12);change(s,"form",-8);log(s,"bad",`没完成赛季目标（${g.text}），你被挤出核心轮换。`);
    if(g.kind==="survive"){s.club.strength=Math.max(58,s.club.strength-6);s.salary=Math.max(2,Math.round((s.salary||4)*.75));log(s,"bad",`${s.club.name}降级，战队实力和你的薪水一起缩水。`)}
    if(s.goalFails>=2){s.salary=Math.max(2,Math.round((s.salary||4)*.8));s.goalFails=0;generateOffers(s,2);log(s,"bad","连续两季不达标，战队下调了你的合同，还暗示你可以走人。")}}
  return{goal:g,met}}

/* ========== 三场挑战：赛季目标之下的短反馈层，16岁起开启 ========== */
const CHALLENGE_TIERS=[
  {tier:"steady",name:"稳妥目标",tone:"",reward:"教练信任+4，状态+3",
   goals:[{kind:"avgRating",target:6.8,text:"三场平均评分达到6.8"},
          {kind:"starts",target:2,text:"至少两场获得首发"},
          {kind:"noLow",target:6,text:"三场都不出现低于6分的评分"}],
   win:s=>{change(s,"coachFavor",4);change(s,"form",3);return"教练信任+4，状态+3"},
   lose:s=>{change(s,"form",-2);return"状态-2"}},
  {tier:"attack",name:"进攻目标",tone:"gold",reward:"人气+3，教练信任+6，奖金",
   goals:[{kind:"contrib",target:2,text:"三场制造2个击杀"},
          {kind:"keyGoal",target:1,text:"至少打进1个关键击杀"},
          {kind:"braceGA",target:1,text:"完成一次单场一杀一助"}],
   win:s=>{change(s,"fame",3);change(s,"coachFavor",6);const b=Math.max(5,Math.round((s.salary||4)*1.5));addMoney(s,b);return`人气+3，教练信任+6，奖金${b}万`},
   lose:s=>{change(s,"form",-3);return"状态-3"}},
  {tier:"daring",name:"冒险目标",tone:"danger",reward:"人气+6，教练信任+10，高额奖金与流派经验",
   goals:[{kind:"goals",target:3,text:"三场拿下3个人头"},
          {kind:"highRating",target:8.5,text:"至少获得一次8.5分"},
          {kind:"winStreak",target:3,text:"帮助战队取得三连胜"}],
   win:s=>{change(s,"fame",6);change(s,"coachFavor",10);const b=Math.max(12,Math.round((s.salary||4)*3));addMoney(s,b);const t=topStyle(s);if(t)addStyleExp(s,t,15);return`人气+6，教练信任+10，奖金${b}万`},
   lose:s=>{change(s,"form",-4);return"状态-4"}}
];
function newChallengeAcc(){return{ratings:[],starts:0,goals:0,assists:0,keyGoals:0,braces:0,wins:0,best:0}}
function challengeMet(c){
  const a=c.acc,avg=a.ratings.length?a.ratings.reduce((x,y)=>x+y,0)/a.ratings.length:0;
  switch(c.kind){
    case"avgRating":return avg>=c.target;
    case"starts":return a.starts>=c.target;
    case"noLow":return a.ratings.length>0&&a.ratings.every(r=>r>=c.target);
    case"contrib":return a.goals+a.assists>=c.target;
    case"keyGoal":return a.keyGoals>=c.target;
    case"braceGA":return a.braces>=c.target;
    case"goals":return a.goals>=c.target;
    case"highRating":return a.best>=c.target;
    case"winStreak":return a.wins>=c.target;
  }
  return false;
}
function challengeProgressText(c){
  const a=c.acc,avg=a.ratings.length?(a.ratings.reduce((x,y)=>x+y,0)/a.ratings.length).toFixed(1):"—";
  switch(c.kind){
    case"avgRating":return`当前均分 ${avg}`;
    case"starts":return`首发 ${a.starts}/${c.target}`;
    case"noLow":return a.ratings.length?`已过 ${a.ratings.length} 场，未失手`:"尚未出场";
    case"contrib":return`${Math.min(a.goals+a.assists,c.target)}/${c.target}`;
    case"keyGoal":return`${Math.min(a.keyGoals,c.target)}/${c.target}`;
    case"braceGA":return`${Math.min(a.braces,c.target)}/${c.target}`;
    case"goals":return`${Math.min(a.goals,c.target)}/${c.target}`;
    case"highRating":return`最高 ${a.best?a.best.toFixed(1):"—"} / ${c.target}`;
    case"winStreak":return`连胜 ${a.wins}/${c.target}`;
  }
  return"";
}
function challengeBannerText(c){return`教练挑战：${c.text}\n进度：${challengeProgressText(c)}｜剩余${Math.max(0,3-c.played)}场`}
// 只有真正出场的比赛才消耗挑战场次——伤停和坐板凳不该把挑战耗光。
function challengeProgress(s,report){
  const c=s.challenge;if(!c||report.role==="未出场")return;
  const a=c.acc;
  a.ratings.push(report.rating);
  if(report.role==="首发")a.starts++;
  a.goals+=report.goals;a.assists+=report.assists;
  a.best=Math.max(a.best,report.rating);
  if(report.goals>=1&&report.assists>=1)a.braces++;
  if(report.goals>0&&(report.timeline.some(t=>t.kind==="goal"&&t.minute>=75)||Math.abs(report.gf-report.ga)<=1))a.keyGoals++;
  if(report.gf>report.ga)a.wins++;
  c.played++;
  if(c.played>=3)settleChallenge(s);
}
function settleChallenge(s){
  const c=s.challenge;if(!c)return;
  const tier=CHALLENGE_TIERS.find(t=>t.tier===c.tier),met=challengeMet(c);
  const effect=met?tier.win(s):tier.lose(s);
  log(s,met?"good":"warn",met?`完成教练挑战（${c.text}）：${effect}。`:`没完成教练挑战（${c.text}）：${effect}。教练没多说什么。`);
  enqueueDecision({title:met?"教练挑战达成":"教练挑战未完成",
    body:`<p>${esc(c.text)}</p><p>最终进度：<b>${esc(challengeProgressText(c))}</b></p><p>${met?`兑现奖励：<b>${esc(effect)}</b>`:`代价：<b>${esc(effect)}</b>。信任没有额外扣减——下一轮重新来过。`}</p>`,
    options:[option(met?"收下":"知道了","",()=>{})]},"三场挑战");
  s.challenge=null;
}
function queueChallengeChoice(s){
  const picks=CHALLENGE_TIERS.map(t=>({def:t,goal:pick(t.goals)}));
  enqueueDecision({title:"教练给了你未来三场的目标",
    body:`<p>周期是三场比赛——只有你真正出场的比赛才算数，伤停不会消耗场次。</p><p class="dialogue">“别跟我谈赛季。先把接下来三场打明白。”</p>`,
    options:picks.map(p=>option(`${p.def.name}：${p.goal.text}`,p.def.reward,
      ()=>{s.challenge={id:`c${Date.now()}${Math.random().toString(36).slice(2,5)}`,tier:p.def.tier,kind:p.goal.kind,target:p.goal.target,text:p.goal.text,played:0,acc:newChallengeAcc()};
           log(s,"story",`接下未来三场的教练挑战：${p.goal.text}。`)},p.def.tone))},"三场挑战");
}
/* 排第一就是冠军。旧写法是满足胜率与实力门槛后再掷一次 48% 的骰子——
   两个赛季表现一模一样、一个拿冠军一个没拿，玩家无从理解。
   现在你把 CQG（实力67）带到榜首，那是真的打出来的。 */
function leagueChampion(s){
  const lg=seasonFinalLeague(s);if(!lg||!lg.teams.length||!lg.played)return false;
  return leagueStandings(lg)[0].name===s.club.name;
}
function seasonAwardCheck(s,rng=Math.random){const ss=s.seasonStats,avg=ss.matches?ss.ratingTotal/ss.matches:0,score=overall(s)*.48+ss.goals*1.15+ss.assists*.65+ss.trophies*7+(s.club.league==="LCK"?6:0)+(s.national.goals||0)*.25+avg*1.6+rndFloat(rng,-5,6),ballon=score>=92+diffOf(s).threshold*1.5,leagueTitle=leagueChampion(s);
  if(leagueTitle){const title=`${s.club.league}冠军`;s.honours.unshift({title,season:ageInfo(s).season,icon:"♛",detail:s.club.name});ss.trophies++;unlock("league_title")}
  if(ballon){s.awards.unshift({title:"年度最佳选手",season:ageInfo(s).season,score:Math.round(score)});s.honours.unshift({title:"年度最佳选手",season:ageInfo(s).season,icon:"●",detail:`评选指数 ${Math.round(score)}`});unlock("ballon");change(s,"fame",15)}
  const result={score:Math.round(score),ballon,leagueTitle,avg:Number(avg.toFixed(1)),goals:ss.goals,assists:ss.assists};s.lastSeasonAward=result;s.seasonStats={matches:0,goals:0,assists:0,wins:0,ratingTotal:0,trophies:0,leagueGoals:0};updateRanking(s);return result}

function careerScore(s){const c=s.statsCareer;return Math.round(overall(s)*18+c.goals*24+c.assists*15+c.nationalGoals*30+s.honours.length*140+s.awards.length*220+s.fame*5+(s.money||0)*2+assetValue(s)*2-(s.debt||0)*6-(s.flags.bettingEver?420:0))}
function applyAging(s){const d=diffOf(s),age=ageInfo(s).age;if(age<d.decayAge)return;const yrs=age-d.decayAge+1,m=d.soft;const drop=base=>Math.max(0,(base+yrs*.7)*m*rndFloat(Math.random,.6,1.3));
  s.attrs.REA=clamp(s.attrs.REA-drop(1.55),1,99);s.attrs.END=clamp(s.attrs.END-drop(.6),1,99);
  if(yrs>=3)s.attrs.LAN=clamp(s.attrs.LAN-drop(.9),1,99);
  s.attrs.MEN=clamp(s.attrs.MEN+.4,1,99);
  log(s,"story",`${age}岁，反应开始走下坡路，你越来越靠经验和位置感吃饭。`)}
function shouldRetire(s){const d=diffOf(s),age=ageInfo(s).age;if(s.flags&&s.flags.washedOut)return"washout";if(age>=d.retireAge)return"age";if(age>=d.decayAge+2&&overall(s)<48)return"decline";if(age>=d.decayAge&&(s.suspension||0)>=18)return"banned";return null}
function endingGrade(s){const c=s.statsCareer,peak=s.peakOverall||overall(s);if(s.flags.gamblingRuined)return{tier:"涉赌禁赛",line:"终场响在调查结果公布那天，不是在赛场上。你坐在一张没有铺桌布的桌子前，对面的人问：<span class='dialogue'>“最后再确认一次——你认识这个号码吗？”</span>你认识。你一直认识，只是花了十几年假装不认识。<br><br>你没有回答，但你的沉默本身就是回答。门关上之前你想打一个电话——你爸、安安、周骁——但号码拨出去之前你就知道，他们不会接了。不是不想接，是你从来没给过他们接的理由。你挂了电话，把手机放在桌上。门关上了，灯灭了。"};if(s.awards.length&&s.national.worldCups&&s.honours.some(h=>h.title==="S赛冠军"))return{tier:"传奇",line:"你把一个中国 ID 写进了 S 赛的历史。最后一局打完那天你没有哭，只绕着舞台走了一圈，把每个位置的椅子都推回去了。<br><br>回到休息室，你从包底拿出那把旧键盘——A 键的字早就磨没了，塞在包里十几年，你从没跟任何人说过它的来历。你把它重新放回去，拉上拉链。走出去时，观众席上还有最后一盏灯没关。"};
  if(s.awards.length||peak>=88)return{tier:"巨星",line:"你站上过这个项目的最高处。数据、奖杯和那些逆转之夜，足够被反复讲很多年。"};
  if(c.goals>=100||s.honours.length>=2||peak>=82)return{tier:"顶级职业选手",line:"你没成为唯一的主角，但打了很多年。最后一场不是什么决赛，就是一场普通的常规赛，你打了两局被换下，下机时拍了拍替补你的人的背。<br><br>你把那把旧键盘放进纸袋里——没有扔，只是不再用了。走出基地大门时你回头看了一眼，保安大爷换了人，不认识你，问你找谁。你说：<span class='dialogue'>“不找谁，走错了。”</span>"};
  if(c.matches>=60||peak>=72)return{tier:"合格职业选手",line:"你靠自律和不服输熬过了一次次替补和伤病。退役的消息只在本地媒体发了一条豆腐块大小的简报，最后一场你坐在替补位上没有上场。<br><br>终场响时你站起来，跟每一个队友击了掌。教练拍拍你的肩膀说“不容易”。走出场馆时天已经黑了，门口那块你站过无数次的合影背景板，在夜色里几乎看不见了。"};
  if(c.matches>0)return{tier:"短暂的职业生涯",line:"职业电竞没给你太多时间，但你确实站上过那个舞台。退役发布会只开了十五分钟，最后一个问题是“如果重来一次，你还会打职业吗”，你沉默三秒说“会的”，但没有人看你的眼睛。<br><br>你留了一件训练服挂在柜子里，没有带走。它后来被保洁收走了，没有人会知道它是谁的。"};
  return{tier:"未竟的赛场梦",line:"你没能真正打进职业赛场，但那把旧键盘陪你走过的日子，不会因此作废。"}}
function buildEnding(s){const c=s.statsCareer,a=ageInfo(s),g=endingGrade(s),love=s.relationship.status;
  const loveEnd=love==="恋人"?`你回到家的时候厨房灯亮着，餐桌上放着一碗绿豆汤，还是烫的。<span class="dialogue">“洗完手再喝。”</span>她在厨房里说，没有抬头。你坐下来了——这是你这么多年来第一次，不用再赶时间。`:love==="异地"?`你收到一条消息：<span class="dialogue">“今天的比赛我看了。那个拖时间有点丢人，不像是你。”</span>你笑了一下，回了两个字：老了。她回了一个表情，没再多说。你们的对话框还留着，上一次聊天是两个月前的生日。`:`你路过那家面馆，透过玻璃看见里面靠窗的位置坐着一个长发的人。你停了一步，然后继续走了。你没有回头，也不知道那是不是她。但你知道，就算是她，你也不会进去了。`;
  /* 宿敌的谢幕。对位领先或落后，他在结尾出场的那句话不同——
     十几年的对手戏，值得一个各自的收尾。 */
  const rd=s.rival&&s.rival.duels,rTotal=rd?rd.win+rd.loss+rd.draw:0;
  const rivalCoda=rTotal>0?(rd.win>rd.loss
    ?`退役发布会后，江彻发来一条消息：<span class="dialogue">“这些年，追你追得很累。谢了。”</span>你回他：彼此。你们约了一顿饭，谁都知道大概率吃不成——但这句话你们说了十几年，说着说着，就把彼此说成了生涯里最重要的人。<br><br>`
    :`你退役那天，江彻在采访里被问起你。他想了几秒，说：<span class="dialogue">“训练时长全队最多的那个人，先下班了。”</span>只有你听得懂这句话是从十四岁那年那间复盘室传来的。记分牌上他赢的次数多一些，但你们都清楚，没有对方，谁也到不了这么远。<br><br>`):"";
  let coda=s.national.called?`退役后你把那封征召信从包底翻出来过一次，折痕快把纸磨穿了。你没告诉任何人，只是读了一遍，重新叠好放回去。<br><br>有一天你收拾东西时发现它不见了，你没有找，只是在原地坐了一会儿。很多年后，有人在你老家那间卧室的墙缝里发现一张泛黄的纸，上面还看得清几个字——<span class="dialogue">“经研究决定……征召……”</span>字迹被潮气洇花了，但那张纸被叠得很整齐，像是有人曾经很认真地保管过它。`:"";
  if(s.flags&&s.flags.worldChampion)coda=`有一年夏天，你们赢到了最后一场。那只奖杯你只抱了很短的时间就要交回去，但那天晚上它的重量，后来很多年你都还记得。<br><br>`+coda;
  coda=rivalCoda+coda;
  return{grade:g.tier,line:g.line,loveEnd,coda,age:a.age,peak:s.peakOverall||overall(s),score:careerScore(s),
    metrics:[[c.matches,"生涯出场"],[c.goals,"击杀"],[c.assists,"助攻"],[c.nationalCaps,"国际赛出场"],[s.honours.length,"奖杯/大赛荣誉"],[s.awards.length,"年度最佳选手"]],
    honours:s.honours.slice(),difficulty:diffOf(s).name}}
function retirePlayer(s,reason){s.retired=true;s.retireReason=reason;
  {const rd=s.rival&&s.rival.duels;if(rd&&rd.win+rd.loss+rd.draw>0&&rd.win>rd.loss)unlock("rival_career")}modalQueue=[];modalBusy=false;if(typeof document!=="undefined")$("modalMask")?.classList.add("hidden");updateRanking(s);const label=reason==="age"?`${ageInfo(s).age}岁，你决定挂靴。`:reason==="banned"?"长期禁赛让你再也回不到从前，你选择离开。":reason==="washout"?"没能站上职业舞台，你把键盘收进了柜子。":"手和状态都告诉你，是时候退役了。";log(s,"story",label);if(typeof document!=="undefined")showEnding(s)}
function defaultMeta(){return{unlocked:{},rankings:[],runs:0}}
function loadMeta(){try{return{...defaultMeta(),...JSON.parse(localStorage.getItem(META_KEY)||"{}")}}catch(e){return defaultMeta()}}
let META=typeof localStorage!=="undefined"?loadMeta():defaultMeta();
function saveMeta(){try{localStorage.setItem(META_KEY,JSON.stringify(META))}catch(e){}}
function unlock(id){if(META.unlocked[id])return;META.unlocked[id]=Date.now();saveMeta();if(typeof document!=="undefined")toast(`成就解锁：${ACHIEVEMENTS.find(a=>a.id===id)?.name||id}`)}
function updateRanking(s){const a=ageInfo(s);const row={runId:s.runId,name:s.name,age:a.age,club:s.club.name,score:careerScore(s),goals:s.statsCareer.goals,awards:s.awards.length,date:new Date().toLocaleDateString("zh-CN")};META.rankings=META.rankings.filter(x=>x.runId!==s.runId);META.rankings.push(row);META.rankings.sort((x,y)=>y.score-x.score);META.rankings=META.rankings.slice(0,10);saveMeta()}
function checkAchievements(s){if(ageInfo(s).age<16&&overall(s)>=70)unlock("academy_70");if(s.statsCareer.goals>=50)unlock("fifty_goals");if(s.statsCareer.goals>=100)unlock("hundred_goals");if(s.statsCareer.assists>=50)unlock("fifty_assists");if(ageInfo(s).age>=24&&s.relationship.status==="恋人"&&s.relationship.love>=70)unlock("loyal_love");if(["恋人","异地"].includes(s.relationship.status)&&s.relationship.love>=95)unlock("deep_bond");if(ageInfo(s).age>=23&&!s.flags.bettingEver)unlock("clean_career")}

let S=null,modalQueue=[],modalBusy=false,prologueIndex=0,prologueClickAt=0,creatorAllocation={...START_ALLOC},creatorOrigin="normal",creatorPosition="mid",creatorTalents=[],creatorDifficulty="standard",rerollsLeft=1,toastTimer=null;
const $=id=>document.getElementById(id);
function saveGame(){if(!S)return false;try{localStorage.setItem(SAVE_KEY,JSON.stringify(S));return true}catch(e){return false}}
/* v2(stats+skills 九个数) → v3(attrs 七项)。属性算不出数（NaN）就整档作废返回 null，
   由 loadGame 回退到「清档重开」，绝不让半初始化的档进游戏——renderAll 直接读 S.attrs[k]。
   form 只是每月都在重算的软数值，缺了就按 v2 的初始值补，不值得为它丢掉整个生涯。
   注意：下面的 morale/teamFit 是 v2「磁盘上」的字段名，游戏里这两个概念都已经删掉了。
   它们只在这个函数里出现——把旧档读进来、折进 form、然后删掉，别照着它们在别处新建变量。 */
function migrateV2toV3(d){
  try{
    if(!d||typeof d!=="object"||!d.stats||!d.skills)return null;
    const st=d.stats,sk=d.skills,num=v=>typeof v==="number"&&Number.isFinite(v)?v:NaN,
      soft=(v,dflt)=>typeof v==="number"&&Number.isFinite(v)?v:dflt;
    const attrs={
      REA:(num(st.speed)+num(st.burst))/2,
      MEC:num(sk.finishing),
      COM:num(sk.vision)*.65+num(sk.setPiece)*.35,
      LAN:num(sk.dribble),
      END:(num(st.height)+num(st.stamina))/2,
      MEN:num(st.will),
      AWA:20+num(st.stamina)*.35+num(st.will)*.15
    };
    for(const k of ATTR_KEYS){
      if(!Number.isFinite(attrs[k]))return null;
      attrs[k]=clamp(attrs[k],1,99);
    }
    const out={...d,version:3,attrs};
    out.form=clamp(Math.round(soft(d.form,60)*.65+soft(d.morale,76)*.35));
    if(!Number.isFinite(out.form))return null;
    delete out.stats;delete out.skills;delete out.morale;delete out.teamFit;delete out.allocation;
    if(!out.originTier)out.originTier="normal";
    if(!POSITIONS.some(p=>p.key===out.position))out.position="mid";
    return out;
  }catch(e){return null}
}
// 只补同版本存档缺失的字段，被删掉的旧训练 id 残留在 actionUsage 里无害。
// v2 的 stats/skills 形状由 loadGame 先交给 migrateV2toV3 摊平，normalizeSave 自己不造 attrs。
function normalizeSave(d){
  if(!d||typeof d!=="object")return d;
  /* 分路与出身是本作新增的两个「选完不能改」字段。老档没有它们，
     不兜底的话 posOf 会拿不到权重表，整张卡面的 OVR 直接变 NaN。 */
  if(!POSITIONS.some(p=>p.key===d.position))d.position="mid";
  if(!Object.hasOwn(ORIGIN_TIERS,d.originTier||""))d.originTier="normal";
  d.matchPlan=MATCH_PLANS.some(p=>p.id===d.matchPlan)?d.matchPlan:"carry";
  d.styles=Object.assign({carry:0,lane:0,macro:0,call:0},d.styles||{});
  if(d.challenge===undefined)d.challenge=null;
  if(d.pendingMatch===undefined)d.pendingMatch=null;
  if(!Array.isArray(d.combosHit))d.combosHit=[];
  /* 星探字段已删，后门改读 fame。老档不迁移的话，一个攒了一年星探关注的
     存档会在16岁突然撞墙——而且不升 VERSION，它不会被清档。 */
  if("scout" in d){d.fame=clamp((d.fame||0)+((d.scout||5)-5));delete d.scout}
  delete d.study;
  if(d.risks){delete d.risks.health;delete d.risks.media;if(typeof d.risks.gambling!=="number")d.risks.gambling=0}
  /* wcRun → cupRun。不升 VERSION，所以一个正打到半决赛的档不会被清掉，
     不迁移就会变成 cupRun 空、wcRun 还挂着的僵尸状态。 */
  if(d.national&&d.national.wcRun&&!d.national.cupRun){
    d.national.cupRun={cup:"world",moments:[],choices:[],...d.national.wcRun};
    delete d.national.wcRun;
  }
  if(d.national&&typeof d.national.asianCups!=="number")d.national.asianCups=0;
  if(d.league===undefined)d.league=null;
  if(d.leaguePrev===undefined)d.leaguePrev=null;
  if(d.rival===undefined)d.rival=null;
  return d;
}
function loadGame(){try{const raw=localStorage.getItem(SAVE_KEY);if(!raw)return null;let data=JSON.parse(raw);
  if(data.version===2){data=migrateV2toV3(data);if(!data){localStorage.removeItem(SAVE_KEY);return null}}
  if(data.version!==VERSION)return null;return normalizeSave(data)}catch(e){return null}}
function toast(text){if(typeof document==="undefined")return;const el=$("toast");if(!el)return;el.textContent=text;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),1800)}

/* 月度小结是本月的收尾，必须守住队尾。事件选项的 apply() 还会再塞东西进来
   （比如选了「立刻要求检查」→ sufferInjury → 「你受伤了」），
   直接 push 会排到小结后面，变成「小结说你伤了」再「通知你伤了」的倒序。 */
function enqueueDecision(d,kicker="关键抉择"){if(!d)return;
  const i=modalQueue.findIndex(m=>m.kicker==="月度小结");
  if(i>=0)modalQueue.splice(i,0,{...d,kicker});else modalQueue.push({...d,kicker});
  pumpModal()}
// 插到队首：让S赛的逐场链条连续播放，不被赛季奖项等其它弹窗打断
function enqueueFront(d,kicker="关键抉择"){if(!d)return;modalQueue.unshift({...d,kicker});pumpModal()}
function pumpModal(){if(modalBusy||!modalQueue.length||typeof document==="undefined")return;modalBusy=true;const d=modalQueue.shift(),mask=$("modalMask"),modal=$("modal"),wrap=$("modalPortraitWrap");$("modalKicker").textContent=d.kicker||"关键抉择";$("modalTitle").textContent=d.title||"抉择";$("modalBody").innerHTML=(typeof d.body==="function"?d.body(S):d.body)||"";
  if(d.portrait){wrap.classList.remove("hidden");$("modalPortrait").src=d.portrait;modal.classList.remove("no-portrait")}else{wrap.classList.add("hidden");modal.classList.add("no-portrait")}
  const opts=typeof d.options==="function"?d.options(S):d.options;$("modalOptions").innerHTML="";(opts||[option("继续","",()=>{})]).forEach((o,i)=>{const b=document.createElement("button");b.className=`option-button ${o.tone||""}`;b.innerHTML=`<b>${esc(o.text)}</b>${o.effect?`<span>${esc(o.effect)}</span>`:""}`;b.addEventListener("click",()=>{b.disabled=true;try{o.apply?.()}finally{mask.classList.add("hidden");modalBusy=false;saveGame();renderAll();setTimeout(pumpModal,80)}});$("modalOptions").appendChild(b)});mask.classList.remove("hidden");const first=$("modalOptions").querySelector("button");if(first)setTimeout(()=>first.focus(),30)}
function trapModalFocus(e){if(e.key!=="Tab"||$("modalMask").classList.contains("hidden"))return;const f=[...$("modalOptions").querySelectorAll("button:not([disabled])")];if(!f.length)return;const first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}

function intimateCheck(s){if(s.flags.intimateUnlocked||ageInfo(s).age<18)return;if(!["恋人","异地"].includes(s.relationship.status))return;if(s.relationship.love<100)return;if(s.flags.intimateCooldown&&s.totalMonth-s.flags.intimateCooldown<6)return;
  enqueueDecision({title:"那个没有回家的夜晚",portrait:"assets/chen-anan.webp",body:`<p>那天赢了一场客场比赛，你打出了决胜的那波团。回到市区已经快凌晨一点，队车停在基地门口。你给她发消息：“我到了。”她回得很快：<span class="dialogue">“我在门口。”</span></p><p>你走出来，看到她站在路灯下面，穿着那件你落在她那里的旧外套。她没问你赢没赢，因为她在观众席上。十一月的夜风很凉，她把拉链往上拉了一格：<span class="dialogue">“我不想一个人回宿舍了。”</span></p><p>你没有说话，她也没有再说第二遍。那天晚上的时间走得很慢，慢到你记得每一个细节——窗帘缝里漏进来的路灯光，她呼吸的节奏，天亮之前她轻轻翻了一个身，没有醒。</p><p>此后很多年，你仍然记得那天晚上的每一个细节。但你从来没有跟任何人提起过。</p>`,options:[
    option("把她拥进怀里，这一夜属于彼此","关系更进一步；此后可选“和安安独处”，状态↑体力↓",()=>{s.flags.intimateUnlocked=true;change(s,"form",17);change(s,"fitness",-14);log(s,"story","天亮时她还睡在你臂弯里，头发散在枕头上。你第一次觉得，除了电竞，生活里还有别的东西值得。")}),
    option("按住冲动，先陪她说说话","感情+4，状态+4；保持现在的节奏",()=>{s.flags.intimateCooldown=s.totalMonth;changeLove(s,4);change(s,"form",4);log(s,"story","你们聊到很晚，最后靠着彼此睡着了。有些事不必赶在今晚。")})]},"两个人");}
function breakupCheck(s){if(!["恋人","异地"].includes(s.relationship.status))return;const conflict=s.relationship.conflict||0;if((s.relationship.conflictShield||0)>0&&conflict>=45&&s.relationship.love>=22){s.relationship.conflictShield--;s.relationship.conflict=30;log(s,"good","青梅羁绊缓冲了一次激烈的争执，你们没有走到分手。");return}
  if((s.relationship.love<22||conflict>=45)&&!s.flags.breakupQueued){s.flags.breakupQueued=true;enqueueDecision({title:conflict>=55?"她不想再替你解释":"有些等待不会自动变成理解",portrait:"assets/chen-anan.webp",body:`<p>对话框停留在三天前。她发的最后一条消息是：“你什么时候有空，我们谈一下。”你回了：“这周赛程太满了，下周吧。”她没有回“好”，也没有回“不行”，什么都没回。</p><p>三天里你没有再收到她的消息。今天你回到宿舍，发现门缝下面塞着一个信封，手写的。你拆开的时候手指很稳，你以为是解释，是吵架，是抱怨。</p><p>但你读到的是：<span class="dialogue">“我不怪你。但我不再等你了。”</span>没有指责，没有控诉。只有这八个字，写在横线纸上，字迹工整，像是写过一遍草稿之后才誊上来的。</p>`,options:[
    option("接受分手，停止纠缠","关系变为分手；心态+2，状态-12",()=>{s.relationship.status="分手";s.relationship.love=0;gain(s,"MEN",2,"will");change(s,"form",-12)}),
    option("公开承担问题并接受边界","冲突-20，感情+8；人气-6、训练状态-5",()=>{s.relationship.conflict=Math.max(0,conflict-20);changeLove(s,8);change(s,"fame",-6);change(s,"form",-5);s.flags.breakupQueued=false})]});}
}

function riskSettlement(s){
  if(s.risks.gambling>=55&&!s.flags.gamblingExploded&&chance(.25)){s.flags.gamblingExploded=true;enqueueDecision({title:"那笔钱终于出现在调查材料里",body:"<p>你已经快忘了那笔钱的事了。你换了手机，删了那条消息，告诉自己那只是一次失误——不影响比分，只有你自己知道你是故意的。但你不知道的是，那场比赛还有三个人做了跟你一样的事。</p><p>调查来得毫无征兆。周一早上你被叫进办公室，里面坐着两个人，桌上摊着打印出来的通话记录。那个你不认识的人开口了，语气很平：<span class='dialogue'>“你认识这个号码吗？”</span></p><p>你认识。那个号码你删过，但你没有忘记过。你的心脏跳得很快，但你听到自己说出口的声音是稳的：<span class='dialogue'>“我不记得了。”</span></p><p>他看了你一眼，没有反驳，把材料翻了一页：<span class='dialogue'>“我们还有时间。你可以再想想。”</span>你坐在椅子上，表面平静，但桌子底下的手一直在掐自己的虎口，只有你自己知道。</p>",options:[option("主动交代并配合调查","停赛6个月，人气-25；保留重返赛场的可能",()=>{s.suspension=6;change(s,"fame",-25);change(s.risks,"gambling",-35);s.awards=[]}),option("否认到底","50%证据不足；否则停赛24个月并失去国际赛资格",()=>{if(chance(.5)){change(s.risks,"gambling",-15);log(s,"warn","调查暂未形成结论，但暗雷没有消失。")}else{s.suspension=24;s.national.called=false;change(s,"fame",-55);s.flags.gamblingRuined=true;log(s,"bad","更多转账与通讯记录被确认，你被长期禁赛。")}},"danger")]})}
  if(s.flags.hivDiagnosed&&s.flags.hivIntermittent){change(s,"fitness",-30);s.injury.risk=clamp((s.injury.risk||0)+8)}
}

const ACTION_FEEDBACK={
  train_apm:["最后一组补刀训练你的手指已经不听使唤，但那零点一秒是真的省下来了。","节拍器从每分钟一百八调到两百二，走砍的间隙终于不再空拍。"],
  train_gym:["跑完五公里回来你什么都不想干，可晚上的训练赛第三局，你还是那个手不抖的人。","肩颈拉伸做到第二十分钟，你第一次觉得这具身体是可以被修的。"],
  train_solo:["一天四十把，输了十九把。你把每一把死亡回放都看了一遍，直到手感发烫。","同一个连招练了上百次，最后一次终于不用想就按出来了。"],
  train_scrim:["训练赛结束别人都下机了，你又把语音复盘听了两遍，笔记记满一页。","你终于弄明白那波团为什么打不赢——不是伤害不够，是你的位置晚站了两秒。"],
  train_vod:["录像一帧帧倒回去，你数清了对面打野那一分钟里走过的每一格。","你把三十个眼位标在地图上，看了很久，然后全部擦掉重画了一遍。"],
  love_time:["你绕远路等在她楼下。安安看到突然冒出来的你，愣了一下，随即笑着跑过来，一头扎进你怀里。","隔着屏幕，你们还是把今天各自的事都讲给了对方听。挂断前谁都不舍得先说再见。"],
  home:["父亲没问你这个月赢了几场，只问手腕还疼不疼。一顿家常饭，你吃得比哪场庆功宴都踏实。","你顺手把一部分钱打回了家。电话那头父亲沉默了很久，最后只说了句“够了够了”。"],
  recover:["你关掉手机，睡到自然醒，第一次没有为“再来一把”感到愧疚。","冰敷、手腕康复、睡眠监测……这些不会出现在集锦里，却让你多打两年。"],
  english:["语音里听不懂的韩语指令，你一条条记下来，第二天硬着头皮喊了一次，队友回了个“굿”。"],
  street:["网吧五黑没有战术板，只有五个人挤在一排机器前。你一挑三反杀，笑得像个孩子。"],
  campus_match:["高校赛的观众席只坐了几十个人，你还是打得手心冒汗，仿佛这就是决赛。"],
  media:["镜头前你学着把每句话说得滴水不漏。切片播出后，粉丝又涨了一批。"],
  coach_talk:["你带着数据面板和录像去找教练，把该说清楚的都说清楚了。"],
  national_role:["你练起了那几个从来不用的版本冷门，队内的常规位训练被分走了一部分。"],
  gift:["你把她念叨过很久的那样东西递过去，安安眼睛一下就亮了，嘴上还嫌你乱花钱。"],
  together:["你们把整座城市关在门外。她的吻从你嘴角一路往下，那一晚很长，也很近，天快亮时才睡去。","她把队服从你身上扒下来，笑你一身汗味，却没有推开你。剩下的时间只属于你们两个人。"]
};
function actionFeedback(a){const arr=ACTION_FEEDBACK[a.id];return arr?pick(arr):`你认真完成了「${a.name}」。`}
function applyAction(id){if(!S||S.actionPoints<=0)return;const a=ACTIONS.find(x=>x.id===id);if(!a||!a.phases.includes(phaseOf(S))||(a.show&&!a.show(S)))return;const used=S.actionUsage[id]||0;if(used>=(a.max||1))return;if(a.cost&&(S.money||0)<a.cost){toast("资金不足，先靠比赛或媒体活动赚钱");return}if(S.injury.months>0&&!['recover','home','english','love_time','gift'].includes(id)){toast("伤停期不能完成高强度行动");return}
  S.actionPoints--;S.actionUsage[id]=used+1;
  actionMult=used>=1?.6:1;actionInjuryMult=used>=1?1.5:1;
  try{a.run(S)}finally{actionMult=1;actionInjuryMult=1}
  if(a.style)addStyleExp(S,a.style,used>=1?6:10);
  unlock("first_action");if(S.flags.weeklyPromise&&id==="train_play"&&used===0){gain(S,"MEC",-.08,"finish")};const fb=actionFeedback(a);S.lastActionFeedback={name:a.name,text:fb,effects:a.effects.join("、")};log(S,"action",fb);checkCombos(S);checkAchievements(S);saveGame();renderAll()}

/* ========== 赛程表 ==========
   对手必须在赛季初就定下来，否则「下一场打谁」这个信息不存在，
   主界面、日程页、赛前预告全都无从谈起。
   月份节奏在这里是唯一定义，shouldPlayMatch 改成查表。 */
function shuffled(arr,rng){const c=[...arr];for(let i=c.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[c[i],c[j]]=[c[j],c[i]]}return c}
/* 从 max(1,seasonStart) 起：advanceMonth 是先 S.totalMonth++ 再判定有没有比赛
   （app.js:1632 在 :1652 之前），所以第一次判定发生在 totalMonth=1，
   第0月的比赛永远打不到。生成它只会在赛程页留一个永远「未打」的幽灵场次，
   还会让主界面的「下一场·本月末」说谎。旧的 shouldPlayMatch 同样从不打第0月。
   第24、48月是换东家的月份（16岁定去向、18岁进职业队），routeChoice16 /
   enterProAt18 会当场改掉 s.club——那个月排联赛说不通，而且赛前预告走
   enqueueFront 会插到生涯分流剧情前面，让玩家在还不知道自己去哪儿的时候
   先选了「本场职责」，比赛还是按旧战队打的。 */
function matchMonthsOfSeason(s,seasonStart){
  const out=[];
  for(let m=Math.max(1,seasonStart);m<seasonStart+12;m++){
    if(m===24||m===48)continue;                       // 换东家的月份不排比赛
    const age=14+Math.floor(m/12),p=age<16?"academy":age<18?(s.route||"academy"):"pro";
    if(age<16){if(m%3===0)out.push(m)}
    else if(p==="campus"){if(m%2===0)out.push(m)}
    /* 第12月是转会期与休赛期：没有比赛，只有年度评选和合同。
       职业选手一年里唯一能喘气的那个月，赛程上必须留着。 */
    else if(m%12!==11)out.push(m);
  }
  return out;
}
function scheduleSig(s){return{season:ageInfo(s).season,clubKey:s.club.name,route:s.route||"",nationalCalled:!!s.national.called}}
/* 赛事日历。电竞的赛季是压在一年里的，不像电竞那样四年一个周期：
     第1—5月 春季赛常规赛
     第6月   MSI 季中冠军赛
     第7—8月 夏季赛常规赛
     第8—9月 夏季赛季后赛两轮（争 S 赛门票）
     第11月  S 赛全球总决赛（拿到资格才排得上）
     第12月  转会期，无比赛，年度评选
   18岁进一队之前不排国际赛事——青训和二队没有那张机票。 */
function cupMonthOf(m){
  if(m>=48&&m%12===10)return "world";
  if(m>=48&&m%12===5)return "msi";
  return null;
}
/* 季后赛只有两轮，且必须落在夏季赛尾部（相对 S 赛月 -3、-2，即第8、9月）。
   原作那套摊六轮是因为一年只有那一个国家队周期；这里一年一届 S 赛，
   摊太多轮会把整个夏季赛吃光，联赛积分榜就没东西可算了。 */
function qualifierMonths(worldsMonth){return [3,2].map(k=>worldsMonth-k)}
/* 同一届季后赛的对手：用 worldsMonth 当种子做确定性洗牌，
   这样赛程无论重建多少次，第2轮永远是同一个对手，两轮之间也不重复。
   随机换对手会让玩家已经看了几个月的日程突然变样。 */
function qualifierOpponent(worldsMonth,round){
  let x=(worldsMonth*2654435761)>>>0;
  const bag=shuffled(PLAYOFF_POOL,()=>((x=(x*1664525+1013904223)>>>0)/4294967296));
  return bag[(round-1)%bag.length];
}
function qualifierRoundAt(m){
  const worlds=Math.floor(m/12)*12+10;              // 该轮归属的 S 赛月
  if(worlds<48)return null;
  const idx=qualifierMonths(worlds).indexOf(m);
  return idx<0?null:{wcMonth:worlds,round:idx+1};
}
function buildSchedule(s,rng=Math.random){
  const seasonStart=Math.floor(s.totalMonth/12)*12,pool=opponentPool(s);
  let bag=[];
  const fixtures=matchMonthsOfSeason(s,seasonStart).map((month,i)=>{
    if(!bag.length)bag=shuffled(pool,rng);
    const opp=bag.shift()||pick(pool);
    return {month,type:"club",opponent:opp.name,strength:opp.strength,home:i%2===0,
      competition:`${s.club.league}第${i+1}轮`,status:"upcoming",result:null};
  });
  /* 国际赛事与季后赛取代当月联赛——那几周你不在常规赛赛程上。
     没拿到过国际赛事名额就没有这条日程。 */
  if(s.national.called)for(let i=0;i<fixtures.length;i++){
    const m=fixtures[i].month,cup=cupMonthOf(m),q=qualifierRoundAt(m);
    /* S 赛要先从季后赛拿到门票才排得上——没打进去那个月就照常打联赛。
       MSI 是春季赛的延伸，不设资格赛，直接排。 */
    if(cup&&(cup==="msi"||s.national.qualifiedFor===m))
      fixtures[i]={month:m,type:"cup",cup,opponent:CUP_CONFIG[cup].title,strength:0,home:false,
        competition:`${CUP_CONFIG[cup].title}正赛`,status:"upcoming",result:null};
    /* 季后赛轮次在这里就把对手抽定，不要留空等 scheduleQualifiers 回填——
       中间那段空窗里日程页和主界面会显示「客 vs 」，对手栏是空的。
       同一届的两轮用 worldsMonth 做种子分配，保证不重复且每次重建结果一致。 */
    else if(q){const o=qualifierOpponent(q.wcMonth,q.round);
      fixtures[i]={month:m,type:"wcq",wcMonth:q.wcMonth,round:q.round,
        opponent:o.name,strength:o.strength,home:q.round%2===1,
        competition:`夏季赛季后赛第${q.round}轮`,status:"upcoming",result:null}}
    /* 洲际表演赛每年一场，排在 S 赛前一个月，同样取代当月联赛。
       它不参与联赛积分，只是让你在大赛之前先摸一次别的赛区的手。 */
    else if(m%12===9){const o=pick(INTL_OPPONENTS);
      fixtures[i]={month:m,type:"national",opponent:o.name,strength:o.strength,home:(m/12)%2===0,
        competition:"洲际表演赛",status:"upcoming",result:null}}
  }
  /* 赛季收官的预告标记：年度评选、赛季目标结算、年龄增长都在赛季末那一刻发生。
     它不是一场比赛（没有对手、不能打），只是让玩家在日程上看得到「这一季还剩几个月」。
     真正触发在下个月初 totalMonth%12===0，所以这一行不参与 played/missed。 */
  fixtures.push({month:seasonStart+11,type:"award",opponent:"",strength:0,home:false,
    competition:"转会期 · 年度评选与合同结算",status:"upcoming",result:null});
  fixtures.sort((a,b)=>a.month-b.month);
  return {...scheduleSig(s),fixtures};
}
/* 只重排未来。转会发生在赛季中途时，已打过的战绩必须留住——
   否则换一次东家就抹掉半个赛季的比分。 */
function ensureSchedule(s,rng=Math.random){
  const sig=scheduleSig(s),sc=s.schedule;
  if(sc&&sc.season===sig.season&&sc.clubKey===sig.clubKey&&sc.route===sig.route&&sc.nationalCalled===sig.nationalCalled)return sc;
  const fresh=buildSchedule(s,rng);
  if(sc){
    /* 保留已打或已过去的场次（战绩不能丢）；
       季后赛场次已排好对手名的也保留——scheduleQualifiers 跨赛季边界时
       ensureSchedule 会重建，若不保留则对手名被清空变成幽灵场次。 */
    /* ⚠️ month>=seasonStart 这道闸不能省：少了它，每翻一个赛季都会把上赛季
       整季留下来，fixtures 无限增长——实测跑到第60月时「本赛季日程」列出 41 行、
       跨越第3~71月。季后赛是唯一的例外，它按设计就跨赛季边界。 */
    const seasonStart=Math.floor(s.totalMonth/12)*12;
    const past=sc.fixtures.filter(f=>f.month>=seasonStart&&(
      (f.type==="wcq"&&f.opponent)||                         // 已抽好对手的季后赛轮次，别被重建清空
      f.status!=="upcoming"||f.month<s.totalMonth));
    const taken=new Set(past.map(f=>f.month));
    fresh.fixtures=[...past,...fresh.fixtures.filter(f=>!taken.has(f.month))].sort((a,b)=>a.month-b.month);
  }
  s.schedule=fresh;return fresh;
}
/* 赛程上不是每一行都能打：award 是赛季收官的预告标记，只用于展示。
   这两个查询必须只返回能打的场次，否则 shouldPlayMatch 会把评选当成一场比赛，
   startMatchFlow 拿它去 prepareMatch 就会炸在没有对手上。 */
const PLAYABLE_FIXTURES=["club","national","wcq","cup"];
function playableFixture(f){return f.status==="upcoming"&&PLAYABLE_FIXTURES.includes(f.type)}
function fixtureOfMonth(s){const sc=s.schedule;return sc?sc.fixtures.find(f=>f.month===s.totalMonth&&playableFixture(f))||null:null}
function nextFixture(s){const sc=s.schedule;return sc?sc.fixtures.find(f=>f.month>=s.totalMonth&&playableFixture(f))||null:null}
/* ========== 联赛积分榜 ==========
   压缩赛制：全联盟就打玩家那么多轮（青训队3 / 校园5 / 韩国青训11 / 职业12），
   不模拟真实的 30/38 轮。按真实赛制个人贡献会被稀释到 1/3，
   会出现「我拿了两个五杀但排名没动」的脱节感。
   轮次直接取赛程里 type==="club" 的场次数，两边永远对齐。 */
/* key 只认联赛，不认战队：LPL内部从 CQG 转到 BLG，
   榜上还是那 16 支队（leagueTeams = 自己 + opponentPool，两边集合完全相同），
   联赛不该因为你换了东家就整个清零——那会让赛程显示打了6轮、榜显示0轮，当场穿帮。
   跨联赛（LPL→LCK）和 16/18 岁分流时 league 会变，照常重建。 */
function leagueSig(s){return{season:ageInfo(s).season,key:s.club.league}}
function leagueTeams(s){
  const me=currentClub(s);
  const rows=[{name:s.club.name,strength:me.strength}];
  opponentPool(s).forEach(o=>{if(!rows.some(r=>r.name===o.name))rows.push({name:o.name,strength:o.strength})});
  return rows.map(r=>({name:r.name,strength:r.strength,p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}));
}
function buildLeague(s){
  const sc=ensureSchedule(s);
  return {...leagueSig(s),rounds:sc.fixtures.filter(f=>f.type==="club").length,played:0,teams:leagueTeams(s)};
}
/* 与 ensureSchedule 同样的懒重建：签名没变就原样返回，
   否则每次渲染都会把已经打完的比分抹掉。 */
function ensureLeague(s){
  const sig=leagueSig(s),lg=s.league;
  if(lg&&lg.season===sig.season&&lg.key===sig.key)return lg;
  /* 旧榜在被顶掉前留一份。职业期赛季首月（totalMonth%12===0）当月就有联赛：
     那场比赛会先重建新赛季的榜，而年度评选在比赛之后才结算——
     不留底的话，冠军就会拿「新赛季第1轮」的榜来判，整季白打。 */
  if(lg)s.leaguePrev=lg;
  s.league=buildLeague(s);return s.league;
}
/* 年度评选要判的是「刚结束的那个赛季」的最终榜。
   评选触发在 totalMonth%12===0，此时 ageInfo.season 已经是新赛季：
   榜没被新赛季碰过就直接用；被首月比赛顶掉了就用留底；
   赛季中途直接调用（测试/工具）则用当前榜。 */
function seasonFinalLeague(s){
  const cur=ageInfo(s).season,lg=s.league;
  if(lg&&lg.season<cur)return lg;
  if(s.leaguePrev&&s.leaguePrev.season===cur-1)return s.leaguePrev;
  return lg&&lg.played?lg:null;
}
/* 联赛惯例：积分 → 净胜小分 → 总小分 → 队名。电竞没有平局，平局列恒为 0，所以榜上直接写「胜负」。 */
function leagueStandings(lg){
  return [...(lg&&lg.teams||[])].sort((a,b)=>
    b.pts-a.pts || (b.gf-b.ga)-(a.gf-a.ga) || b.gf-a.gf || a.name.localeCompare(b.name));
}
/* 按「赛季 + 轮次」派生的确定性种子。
   不这么做的话，读档、切 tab、重渲染都可能让已经打完的历史比分变样——
   玩家会看到自己上个月明明赢了的那场，回头再看变成输了。 */
function leagueRng(seasonNo,round){
  let x=(((seasonNo*73856093)^(round*19349663))>>>0)||1;
  return ()=>((x=(x*1664525+1013904223)>>>0)/4294967296);
}
/* 两支战队之间打一场。只看实力差 + 随机，不带任何玩家个人加成——
   玩家那场的比分是外面直接传进来的，不走这里。 */
function simLeagueMatch(aStr,bStr,rng){
  const edge=aStr-bStr+rndFloat(rng,-8,8);
  return toSeries(poisson(clamp(1.25+edge/18,.2,3.6),rng),poisson(clamp(1.2-edge/22,.2,3.4),rng),rng,3);
}
function applyLeagueResult(row,gf,ga){
  if(!row)return;
  row.p++;row.gf+=gf;row.ga+=ga;
  if(gf>ga){row.w++;row.pts+=3}else if(gf===ga){row.d++;row.pts+=1}else row.l++;
}
/* 这场联赛是本季第几轮。按赛程里 type==="club" 的场次顺序数，
   跳过被大赛占用的月份——所以第几轮≠第几个月。 */
function clubRoundOf(s,month){
  const sc=s.schedule;if(!sc)return 1;
  const list=sc.fixtures.filter(f=>f.type==="club").sort((a,b)=>a.month-b.month);
  const i=list.findIndex(f=>f.month===month);
  return i<0?list.length+1:i+1;
}
/* 推进一轮。play.opponent / play.result 是玩家那场的真实结果：
   传了就原样计入（榜上那一行必须和赛程页、比赛简报是同一个结果），
   传 null 表示玩家没上场——但战队不弃权，照样模拟，只是不带个人加成。
   队伍数为奇数时每轮随机一队轮空，轮空不计场次。 */
function advanceLeagueRound(s,play,round){
  const lg=ensureLeague(s);if(!lg)return lg;
  /* 同一轮不许算两次。T3 会从两条路径调它（玩家上场 / 伤停缺阵），
     读档重放或两边同时触发都可能让同一轮进来两次，那样全队各多打一场，
     x.p 会超过 lg.rounds——静默的数据损坏，榜上看不出哪里错了。 */
  if(round<=lg.played)return lg;
  const rng=leagueRng(lg.season,round);
  const byName=n=>lg.teams.find(t=>t.name===n);
  const done=new Set();
  if(play&&play.opponent&&play.result){
    const me=byName(s.club.name),foe=byName(play.opponent);
    if(me&&foe){
      applyLeagueResult(me,play.result.gf,play.result.ga);
      applyLeagueResult(foe,play.result.ga,play.result.gf);
      done.add(me.name);done.add(foe.name);
    }
  }
  const roundGf={};                          // 本轮各队击杀，宿敌份额要用
  if(play&&play.opponent&&play.result){roundGf[s.club.name]=play.result.gf;roundGf[play.opponent]=play.result.ga}
  const rest=shuffled(lg.teams.filter(t=>!done.has(t.name)),rng);
  if(rest.length%2===1)rest.pop();          // 奇数：末位轮空，不计场次
  for(let i=0;i<rest.length;i+=2){
    const A=rest[i],B=rest[i+1];
    const r=simLeagueMatch(A.strength,B.strength,rng);
    applyLeagueResult(A,r.gf,r.ga);applyLeagueResult(B,r.ga,r.gf);
    roundGf[A.name]=r.gf;roundGf[B.name]=r.ga;
  }
  lg.played=Math.max(lg.played,round);
  /* 宿敌与你的联赛同步推进。他在你的榜上就分他战队的击杀份额（轮空=0），
     不在就走独立模型。 */
  {const rv=ensureRival(s);   // 先翻季/转会，再读他的战队——顺序反了他会分走别人战队的击杀
   if(rv&&rv.club){
     const sameLeague=lg.key===rv.club.league;
     rivalRoundAdvance(s,round,sameLeague?(roundGf[rv.club.name]??0):null);
   }}
  return lg;
}
/* ========== 宿敌：江彻 ==========
   和你同届的铜梁龙青训队前锋，14岁时就是「天才是他、努力是你」的那一个。
   16岁走你没走的那条路，18岁起每个赛季和你比击杀——对位之争是
   「你的赛季击杀 vs 他的」，不是联赛金靴：跨联赛依然成立，
   也绕开了给全联盟建个人数据的深坑（积分榜设计里已否决）。 */
const RIVAL_NAME="江彻";
function rivalRng(seasonNo,round){
  let x=(((seasonNo*2654435761)^(round*97531)^0x9e3779b9)>>>0)||1;
  return ()=>((x=(x*1664525+1013904223)>>>0)/4294967296);
}
/* 年龄基线取自12局生涯实测的玩家成长曲线（18岁≈73，24岁≈84，巅峰≈91）。
   基线只是锚，最终等级被软回归拉着走。 */
function rivalBaseLevel(age){return age<=30?Math.min(91,61+(age-14)*2.35):Math.max(74,91-(age-30)*1.4)}
function rivalClubPick(s,seasonNo){
  const league=s.rival.route==="overseas"?"LCK":"LPL";
  const pool=(league==="LCK"?LCK_TEAMS:LPL_TEAMS).filter(c=>c.name!==s.club.name);
  const rng=rivalRng(seasonNo,777);
  return {...pool[Math.floor(rng()*pool.length)]};
}
/* 成长曲线：软回归，不是橡皮筋。
   纯静态：玩家练得快或慢，第3个赛季后对位胜负永远定死，之后十年是垃圾时间。
   全橡皮筋：假——玩家会发现无论怎么练都五五开，对位立刻失去意义。
   折中：差距压在 ±6 内。你摆烂他甩开你，你练猛他咬住你，
   但胜负始终由你最近的表现主导。 */
function ensureRival(s){
  if(!s.rival)s.rival={name:RIVAL_NAME,route:null,level:0,club:null,goals:0,careerGoals:0,
    duels:{win:0,loss:0,draw:0},injuredFrom:0,injuredRounds:0,season:0};
  const rv=s.rival,info=ageInfo(s);
  if(rv.route===null&&s.flags.route16)
    /* 镜像：走你没走的那条路。你签国内他出海；你出海他留LPL；
       你回校园——他签下了你放弃的那份职业合同。
       18岁后 route 已被覆写成 "pro"（老档），退回用联赛反推：
       你在LCK他就在LPL，反之亦然。 */
    rv.route=s.route==="firstteam"?"overseas"
      :s.route==="overseas"?"firstteam"
      :s.route==="campus"?"firstteam"
      :(s.club.league==="LCK"?"firstteam":"overseas");
  if(rv.season===info.season)return rv;
  /* 翻季前把上赛季击杀留底。职业期赛季首月当月就有比赛，重建发生在
     年度评选之前——不留底，对位结算读到的就是清零后的数字，
     玩家会发现自己「永远赢」。和 leaguePrev 同一个坑。 */
  rv.prevGoals=rv.goals;rv.prevSeason=rv.season;
  rv.season=info.season;rv.goals=0;
  const rng=rivalRng(info.season,101);
  rv.level=Math.round(clamp(rivalBaseLevel(info.age)+rndFloat(rng,-2,2),overall(s)-6,overall(s)+6));
  if(info.age>=18&&rv.route){
    /* 18岁签约；之后每赛季 30% 概率转会（他也有自己的生涯）。
       永远避开玩家的战队——同队抢首发是另案。 */
    if(!rv.club||rng()<.3||rv.club.name===s.club.name)rv.club=rivalClubPick(s,info.season);
    /* 伤病：约15%概率赛季中伤停2-3轮，制造「他伤了你趁机拉开」的年份差异。 */
    const hurt=rng();
    if(hurt<.15){rv.injuredRounds=hurt<.05?3:2;rv.injuredFrom=4+Math.floor(rng()*5)}
    else{rv.injuredRounds=0;rv.injuredFrom=0}
  }
  return rv;
}
/* 对位从18岁职业期开始——青训队一季3轮样本太小，14-18岁他只活在剧情里。 */
function rivalActive(s){return !!(s.rival&&s.rival.club&&ageInfo(s).age>=18)}
function rivalAddGoals(rv,n){if(n>0){rv.goals+=n;rv.careerGoals+=n}}
/* 每当你的联赛推进一轮，他那边也推进一轮（两边赛季轮数同为12）。
   同联赛：他的击杀是榜上他战队该轮击杀的份额，两边永远对得上；
   跨联赛：他的联赛不在你的榜上，按同一公式独立生成。
   种子按（赛季,轮次）派生——读档、重渲染不改历史，与积分榜同一纪律。 */
function rivalRoundAdvance(s,round,teamGf){
  const rv=ensureRival(s);
  if(!rivalActive(s))return;
  if(rv.lastRound===`${rv.season}#${round}`)return;   // 同轮防重，与积分榜同一守卫
  rv.lastRound=`${rv.season}#${round}`;
  if(rv.injuredRounds&&round>=rv.injuredFrom&&round<rv.injuredFrom+rv.injuredRounds)return;   // 伤停轮不击杀
  const rng=rivalRng(rv.season,round*7+3);
  if(teamGf!==null){
    /* 份额模型：战队每拿一个人头，他都有一份参与概率。等级越高、战队越弱，份额越大。 */
    const share=clamp(.46+(rv.level-rv.club.strength)/42,.22,.84);
    let n=0;for(let i=0;i<teamGf;i++)if(rng()<share)n++;
    rivalAddGoals(rv,n);
  }else{
    /* 独立模型：先模拟他战队该轮的击杀，再走同一个份额。
       对手强度取他联赛的平均实力，避免引入整个第二联赛的配对模拟。 */
    const leagueAvg=rv.club.league==="LCK"?81:71;
    const r=simLeagueMatch(rv.club.strength,leagueAvg,rng);
    const share=clamp(.46+(rv.level-rv.club.strength)/42,.22,.84);
    let n=0;for(let i=0;i<r.gf;i++)if(rng()<share)n++;
    rivalAddGoals(rv,n);
  }
}
/* 生涯页的宿敌卡。18岁前他只活在剧情里，不比数字——青训队一季3轮，
   比了也只是噪声。 */
function rivalCardHTML(s){
  const rv=s.rival;if(!rv)return"";
  if(!rivalActive(s))
    return `<article class="info-card"><h3>宿敌 · ${RIVAL_NAME}</h3><p>${
      s.flags.route16
        ?(rv.route==="overseas"?"他去了海外。你们走上了两条路，但你知道总有一天要在记分牌上碰面。"
                               :"他留在了国内赛场。你们走上了两条路，但你知道总有一天要在记分牌上碰面。")
        :"青训队里天赋最好的那一个。教练夸你努力的时候，夸的是他的天赋。"}</p></article>`;
  const you=s.seasonStats.leagueGoals||0,him=rv.goals,d=rv.duels;
  const status=rv.injuredRounds&&s.league&&s.league.played>=rv.injuredFrom
    ?"他手伤了，这个赛季要少打两三轮——今年是拉开差距的机会。"
    :him>you?"他最近的击杀又上了头条。":you>him?"这个赛季，头条暂时是你的。":"咬得很紧，谁也没甩开谁。";
  return `<article class="info-card"><h3>宿敌 · ${RIVAL_NAME}<small style="float:right;color:var(--muted)">${esc(rv.club.name)} · ${esc(rv.club.league)}</small></h3>`+
    `<div class="effect-line"><span>本赛季联赛对位 你 ${you} 杀 : ${him} 杀 他</span>`+
    `<span>生涯对位 ${d.win}胜 ${d.draw}平 ${d.loss}负</span><span>他的等级 ${rv.level}</span></div>`+
    `<p>${status}</p></article>`;
}
/* 赛前预告里点名：只在联赛、且对面正是他的战队时出现。 */
function rivalEveLine(s,fx){
  const rv=s.rival;
  if(!rivalActive(s)||!fx||fx.type!=="club"||fx.opponent!==rv.club.name)return"";
  return `<p class="dialogue">${RIVAL_NAME}在对面首发。本场击杀压过他，状态小涨；被他压过，反之。</p>`;
}
/* 赛季末对位结算：比的是赛季击杀，赢/平/负记进 duels。
   必须在 seasonAwardCheck 重置 seasonStats 之前调——晚一步你的击杀就归零了。 */
function rivalSeasonSettle(s){
  if(!rivalActive(s))return null;
  /* 评选在赛季首月触发，此时他可能已被首月比赛翻季（goals 已清零重计）。
     被翻季就取留底 prevGoals——和 seasonFinalLeague 同一套时序纪律。 */
  const rv=s.rival,you=s.seasonStats.leagueGoals||0,
    him=rv.season===ageInfo(s).season&&rv.prevSeason===ageInfo(s).season-1&&rv.prevGoals!==undefined?rv.prevGoals:rv.goals;
  const result=you>him?"win":you<him?"loss":"draw";
  rv.duels[result]++;
  rv.streak=result==="win"?(rv.streak||0)+1:0;
  if(result==="win")unlock("rival_first_win");
  if(rv.streak>=3)unlock("rival_streak3");
  return {you,him,result,name:RIVAL_NAME};
}
/* 还有几次「结束本月」才打到这场。advanceMonth 是先 ++ 再判定，
   所以 month=totalMonth+1 的那场，下一次点「结束本月」就开打——
   那是「本月末」，不是「还有1个月」。差一位会让主界面一直骗玩家。 */
function fixtureCountdown(s,fx){return fx?Math.max(0,fx.month-s.totalMonth-1):-1}
function shouldPlayMatch(s){if(s.flags&&s.flags.washedOut)return false;if((s.injury.months||0)>0)return false;return !!fixtureOfMonth(s)}
// 返回 modal 对象而不直接入队——finishMonth 需要把它排在月度小结之前。
function buildMatchReportModal(report){return{kicker:report.classic?"经典之战":"比赛简报",title:`${report.competition} · ${report.club} ${report.gf}-${report.ga} ${report.opponent}`,body:`${report.classic?'<div class="classic-tag">这一局会被记很久</div>':""}<div class="match-score"><span class="match-team">${esc(report.club)}</span><strong>${report.gf} : ${report.ga}</strong><span class="match-team">${esc(report.opponent)}</span></div><p>你${report.role}${report.rating?`，评分 <b>${report.rating}</b>`:""}；${report.goals} 杀，${report.assists} 助攻。</p><div class="timeline-list">${report.timeline.map(t=>`<div class="timeline-row"><b>${t.minute}'</b><span>${esc(t.text)}</span></div>`).join("")}</div><div class="factor-row"><div class="factor"><b>${report.model.ability}</b><span>能力基础 · 约60%</span></div><div class="factor"><b>${report.model.condition}</b><span>状态精力 · 约25%</span></div><div class="factor"><b>${report.model.random}</b><span>临场波动 · 约15%</span></div></div>`,options:[option("收下这场比赛","数据已计入生涯统计",()=>{})]}}
function queueMatchReport(s,report){enqueueDecision(buildMatchReportModal(report),report.classic?"经典之战":"比赛简报")}

function queueEvent(s,e){enqueueDecision({title:e.title,body:e.body,portrait:e.portrait,options:e.options(s)},"两月事件")}
function queueStory(s,beat){enqueueDecision({title:beat.title,body:beat.body,portrait:beat.portrait,options:beat.options},"半年剧情")}
function queueNationalCall(s){enqueueDecision({title:"名单上有你",portrait:"assets/father.webp",body:`<p>名单是在群里发的。一张截图，队标，五个 ID，你的在第三个。</p><p>你盯着看了一会儿。你从小在直播里看过很多次别人第一次拿到国际赛名额的样子——有人会哭，会当场打电话给家人。但你只是坐在那里，手还放在鼠标上。你想到的不是荣耀，而是门诊部三楼的收费窗口，想到你爸在病床上说的“打给爸看”，想到安安最后一次站在场馆外的雨里等你，她什么时候走的你都不知道。</p><p>你把手机翻到反面扣在桌上，坐了一会儿。然后你站起来，从包最里面的夹层摸了一下——那把 A 键磨没了的旧键盘还在那儿。</p><p>你拉上拉链，走出去。训练室的灯已经亮了。</p>`,options:[option("接受","国际赛事功能开放；精力管理压力增加",()=>{})]},"国际赛事")}
function queueNationalReport(r){enqueueDecision({title:`洲际表演赛 ${r.gf}-${r.ga} ${r.opponent}`,body:`你代表赛区出场，拿下 <b>${r.goals}</b> 个人头。${r.gf>r.ga?"赢下这种场子不算数据，但整个赛区都在转你的切片。":r.gf<r.ga?"输给别的赛区，弹幕会记很久。下一次集训已经写进日历。":"没分出高下，手腕的酸倒是很具体。"}`,options:[option("返回战队","本场数据已归档",()=>{})]},"为赛区而战")}function queueAward(r,s,goalResult,rivalDuel){const gLine=goalResult?`<p class="dialogue" style="border-color:${goalResult.met?'#0ac8b9':'#e0564f'}">赛季目标${goalResult.met?"达成":"未达成"}：${esc(goalResult.goal.text)}。${goalResult.met?"奖金与信任到账。":"信任下滑，位置不保。"}</p>`:"";
  const rLine=rivalDuel?`<p class="dialogue">对位：你 ${rivalDuel.you} 杀，${esc(rivalDuel.name)} ${rivalDuel.him} 杀——${rivalDuel.result==="win"?"今年你压他一头。":rivalDuel.result==="loss"?"今年他压你一头。":"平分秋色，明年再算。"}</p>`:"";enqueueDecision({title:r.ballon?"年度最佳选手属于你":"年度评选揭晓",body:`本赛季 ${r.goals} 杀、${r.assists} 助攻，平均评分 ${r.avg}，评选指数 <b>${r.score}</b>。${r.ballon?"当主持人念出你的名字，你先想到的不是聚光灯，而是父亲当年扛回家的那台旧机器。":"你进入了候选讨论，但奖杯属于另一个赛季表现更完整的人。"}${r.leagueTitle?`<p class="dialogue">同时，你随${esc(s.club.name)}赢得${esc(s.club.league)}冠军。</p>`:""}${rLine}${gLine}`,options:[option("进入下一赛季","年度数据已经归档",()=>{})]},"年度荣誉")}

// ===== S赛：季后赛门槛 + 随机抽签 + 逐场可玩（淘汰赛临场战术）=====
const CUP_STAGE_NAMES=["瑞士轮第1轮","瑞士轮第2轮","瑞士轮第3轮","八强赛","半决赛","决赛前夜","决赛"];
/* 两个赛事同构，差别全部收在这张表里。
   判定、决胜局、出线规则、中断恢复一律共用——绝不为 MSI 复制一份流程。
   这里没有任何难度补正：MSI 更容易夺冠，纯粹因为 elite 池小得多
   （MSI 只有各赛区春季冠亚军，S 赛淘汰赛池 84~93）。 */
const CUP_CONFIG={
  world:{title:"S赛全球总决赛",group:()=>WORLDS_GROUP_POOL,elite:()=>WORLDS_ELITE_POOL,
    honour:"S赛冠军",icon:"S",achievement:"world_cup",counter:"worldCups",champFame:25},
  msi:{title:"MSI季中冠军赛",group:()=>MSI_GROUP_POOL,elite:()=>MSI_ELITE_POOL,
    honour:"MSI冠军",icon:"M",achievement:"asian_cup",counter:"asianCups",champFame:14}
};
/* 赛区旗帜是赛事信息的一部分，不再让玩家只读一串战队名。
   这里用系统彩色 emoji 做小尺寸旗标：它比生图/网络图片稳定，离线也能显示，
   赛事画面本身仍由独立美术素材负责。战队 → 赛区的归属只在这张表里定义一次。 */
const TEAM_REGION=Object.freeze({
  "CQG":"LPL","BLG":"LPL","TES":"LPL","JDG":"LPL","LNG":"LPL","WBG":"LPL","AL":"LPL","IG":"LPL","FPX":"LPL",
  "OMG":"LPL","NIP":"LPL","EDG":"LPL","WE":"LPL","TT":"LPL","RNG":"LPL","UP":"LPL","LGD":"LPL","RA":"LPL",
  "T1":"LCK","Gen.G":"LCK","Hanwha Life":"LCK","KT Rolster":"LCK","Dplus KIA":"LCK",
  "Nongshim RedForce":"LCK","BNK FearX":"LCK","DN Freecs":"LCK","DRX":"LCK","OKBRO":"LCK",
  "G2 Esports":"LEC","Fnatic":"LEC","MAD Lions":"LEC","Movistar KOI":"LEC",
  "FlyQuest":"LTA","100 Thieves":"LTA","Team Liquid":"LTA","paiN Gaming":"LTA",
  "PSG Talon":"LCP","CTBC Flying Oyster":"LCP","GAM Esports":"LCP","Vikings Esports":"LCP"
});
const REGION_FLAGS=Object.freeze({
  "LPL":"🇨🇳","LCK":"🇰🇷","LEC":"🇪🇺","LTA":"🇺🇸","LCP":"🌏","VCS":"🇻🇳","CBLOL":"🇧🇷","高校联赛":"🎓","LDL":"🇨🇳"
});
/* 传进来的可能是战队名，也可能是赛区名——两种都要认。
   认不出来的一律给中立旗，绝不让界面上出现一个空格。 */
function regionOf(name){return TEAM_REGION[name]||(REGION_FLAGS[name]?name:"")}
function countryFlag(name){return REGION_FLAGS[regionOf(name)]||"🏳️"}
/* 战队实力改用 FIFA 那样的五星制，不再把 58:74 并排写成比分——
   那读起来像另一种比分，而且 0~100 的原始数字对玩家没有直觉。
   全游戏实力区间约 49（校园队）~93（巴西/法国），映射到 0.5~5 星、半星粒度：
     校园 0.5~1.5 · LPL 2~3.5 · LCK豪门 5 · S赛淘汰赛池 4~5。
   原始数值仍放进 title，想抠细节的还能看到。 */
function strengthStars(v){return clamp(Math.round((v-44)/10*2)/2,.5,5)}
function starRating(v,opts={}){
  const st=strengthStars(v),pct=(st/5*100).toFixed(1),txt=String(st).replace(/\.0$/,"");
  return `<span class="star-rating${opts.small?" small":""}" title="实力值 ${Math.round(v)}" role="img" aria-label="实力 ${txt} 星，满分5星">`+
    `<span class="star-track" aria-hidden="true"><i style="width:${pct}%"></i></span>`+
    (opts.hideNumber?"":`<b>${txt}</b>`)+`</span>`;
}
/* 队名 + 名下的星级，联赛/杯赛/国际赛共用一个组件，三条线不会各长各的。 */
function teamStrengthBlock(name,strength,sub="",flag=false){
  return `<div class="team-strength"><b>${flag?countryFlag(name)+" ":""}${esc(name)}</b>`+
    `${starRating(strength)}${sub?`<small>${esc(sub)}</small>`:""}</div>`;
}
function flagBadge(name,label=name,compact=false){return `<span class="flag-badge${compact?" compact":""}" title="${esc(label)} 赛区" aria-label="${esc(label)} 赛区"><span class="flag-emoji" aria-hidden="true">${countryFlag(name)}</span>${compact?"":`<span>${esc(label)}</span>`}</span>`}
function cupFixtureBoard(opp,stage="比赛日",myStrength=null,myName="我的战队"){
  const name=opp&&opp.name||"对手",oppS=opp&&opp.strength;
  return `<div class="cup-fixture-board"><div class="cup-side"><span class="flag-hero" aria-hidden="true">${countryFlag(myName)}</span><b>${esc(myName)}</b>${Number.isFinite(myStrength)?starRating(myStrength):""}<small>${esc(regionOf(myName)||"我的战队")}</small></div><div class="cup-vs"><span>${esc(stage)}</span><strong>VS</strong></div><div class="cup-side"><span class="flag-hero" aria-hidden="true">${countryFlag(name)}</span><b>${esc(name)}</b>${Number.isFinite(oppS)?starRating(oppS):""}<small>${esc(regionOf(name)||"对手赛区")}</small></div></div>`
}
function cupOpeningCopy(cup,draw,myName="我的战队"){
  const cfg=CUP_CONFIG[cup];
  const group=draw.group.map(o=>flagBadge(o.name,o.name)).join("");
  const ko=draw.ko.map(o=>flagBadge(o.name,o.name,true)).join("");
  return `<div class="cup-opening-copy ${cup}"><div class="cup-opening-label"><span class="flag-hero small" aria-hidden="true">${countryFlag(myName)}</span><div><b>${esc(myName)}</b><small>${cfg.title} · 正赛</small></div></div><div class="cup-draw-block"><span>小组赛对手</span><div class="flag-list">${group}</div></div><div class="cup-draw-block knockout"><span>可能的淘汰赛对手</span><div class="flag-list compact-list">${ko}</div></div></div>`
}
function trophyPortrait(cup){
  const world=cup==="world";
  return `<div class="trophy-portrait ${world?"world":"msi"}" role="img" aria-label="${world?"S赛":"MSI"}冠军奖杯立绘"><div class="trophy-light"></div><div class="trophy-shape" aria-hidden="true">🏆</div><b>${world?"召唤师奖杯":"MSI 奖杯"}</b><span>${world?"S赛":"MSI"} · 领奖台</span></div>`
}
function cupCfg(s){const run=s.national.cupRun;return CUP_CONFIG[(run&&run.cup)||"world"]}
function cupDraw(rng,cfg){
  const take=(pool,n)=>{const c=[...pool],out=[];for(let k=0;k<n&&c.length;k++)out.push(c.splice(Math.floor(rng()*c.length),1)[0]);return out};
  const c=cfg||CUP_CONFIG.world;
  return {group:take(c.group(),3),ko:take(c.elite(),4).sort((a,b)=>a.strength-b.strength)};
}
/* 季后赛不再一屏掷完8场——那让玩家整整一年的投入变成一次读秒。
   摊成6轮排进赛程，每轮走完整比赛管线，你的击杀真的决定积分。 */
function nationalStrength(s){return 74+(overall(s)-72)*.72+(s.national.adapt||0)*.06+(hasTalent(s,"red_shirt")?2:0)}
function scheduleQualifiers(s,wcMonth,rng=Math.random){
  const months=qualifierMonths(wcMonth).filter(m=>m>=s.totalMonth);
  if(!months.length)return null;
  const sc=ensureSchedule(s);
  months.forEach((m,i)=>{
    let f=sc.fixtures.find(x=>x.month===m);
    if(!f){
      /* 季后赛轮次可能跨赛季边界（如 totalMonth=83 时月84属于下一赛季）。
         找不到就直接插入一条——ensureSchedule 下次重建时会通过 past 条件保留它。 */
      const o0=qualifierOpponent(wcMonth,i+1);
      f={month:m,type:"wcq",wcMonth,round:i+1,opponent:o0.name,strength:o0.strength,home:i%2===0,
        competition:`季后赛第${i+1}轮`,status:"upcoming",result:null};
      sc.fixtures.push(f);sc.fixtures.sort((a,b)=>a.month-b.month);
    }
    f.type="wcq";f.wcMonth=wcMonth;f.round=i+1;
    const o=qualifierOpponent(wcMonth,i+1);
    f.opponent=o.name;f.strength=o.strength;f.home=i%2===0;
    f.competition=`季后赛第${i+1}轮`;f.status="upcoming";f.result=null;
  });
  /* 出线线按轮数折算。原来8场需 11+d.threshold 分（11/24≈.458），
     6场18分同比例约8分。中途才被征召的按剩余轮数同比缩——
     否则一个月90才首次入选的国脚必然出局，那不是难度，是无解。 */
  s.national.wcQual={wcMonth,rounds:months.length,played:0,points:0,
    threshold:Math.max(1,Math.round(months.length*3*.458)+diffOf(s).threshold),
    results:[],settled:false};
  return s.national.wcQual;
}
function settleQualifiers(s){
  const q=s.national.wcQual;if(!q||q.settled)return;
  q.settled=true;
  const qualified=q.points>=q.threshold;
  /* 出线与否决定那个月排不排正赛。没打进去，第96月就照常打联赛——
     这一年的两轮是你自己打的，结果也该由它决定。 */
  if(qualified){s.national.qualifiedFor=q.wcMonth;s.flags.worldcup_qualified=true;ensureSchedule(s)}
  enqueueDecision({title:qualified?"季后赛出线！":"季后赛出局",
    body:`<div class="story-list">${q.results.map(m=>`<div class="story-log"><time>${m.gf>m.ga?"胜":m.gf===m.ga?"平":"负"}</time><div><h3>${esc(s.club.name)} ${m.gf}-${m.ga} ${esc(m.opp)}</h3><p>你 ${m.goals} 杀 ${m.assists} 助</p></div></div>`).join("")}</div>`+
      `<p>${q.rounds}场积 <b>${q.points}</b> 分（出线线 ${q.threshold}）。${qualified?`${esc(s.club.name)} 拿到了 S 赛门票！`:""}</p>`,
    options:[qualified
      ?option("给家里打电话","",()=>enqueueFront({title:"父亲要去看S赛",portrait:"assets/father.webp",body:`<p>电话响到第七声他才接，背景里有机器的声音——他还在厂里。</p><p>你说队伍出线了。他"嗯"了一声，隔了两秒，问的是：<span class="dialogue">"去那边看一场，要花多少钱。"</span></p><p>你说我给你买票。他说那不用，你比赛要紧。然后又问了一遍：<span class="dialogue">"多少钱。"</span></p>`,/* 这里绝不能直接开赛：出线只是把正赛排进了日程（qualifiedFor + ensureSchedule），
   真正开打由那个月的 type:"cup" fixture 触发。两边都开会把整届S赛打两遍，
   而且第一遍还提前两个月。 */
options:[option("记住这一天","正赛已排进日程，到那个月自然开赛",()=>{s.national.wcQual=null})]},"S赛"))
      :option("走出赛场","",()=>enqueueFront({title:"最后一轮的终场",portrait:"assets/father.webp",
        body:`<p>积分榜挂在休息室走廊的电视上，没有人去关。差的那几分是哪一场丢的，每个人心里都有一本账，但谁都没说。</p>`+
          `<p>你换衣服的时候手机震了一下。是你爸：<span class="dialogue">“看完了。”</span>隔了很久又来一条：<span class="dialogue">“下次还有。”</span></p>`+
          `<p>你想回一句什么，打了两遍都删了。四年后你${ageInfo(s).age+4}岁——这个数字你不用算，它一直在那儿。</p>`,
        options:[option("把这一年收起来","本届数据已归档",()=>{s.national.wcQual=null})]},"夏季赛季后赛"))]},"夏季赛季后赛");
}
/* ========== 决胜局（BO5 打到 2-2 之后的最后一局）==========
   函数名沿用了原作的 penalty/shootout：它们描述的是「双方轮流做一次高压判定，
   五轮定胜负，仍平则加时」这个结构，和原作那套判定同构。改名要动十七处且没有收益。
   三个选项刻意不是「同一条曲线上的三个点」：稳打对 MEC 最敏感、等对面
   走 MEN 且对精力最钝、抢先手成功率最低但成功会被记住。因为决胜局是二元
   结果，若三者只差成功率，最高的那个必然严格占优、另外两个就是死选项。 */
const PENALTY_OPTIONS=[
  {id:"bold",text:"抢先手强开",tip:"成功率最低，但这一下会被记住",stat:"MEC",bold:true},
  {id:"steady",text:"按训练赛那样打",tip:"最不容易崩",stat:"MEC"},
  {id:"wait",text:"等对面先动",tip:"最不受精力影响",stat:"MEN"}
];
/* 你在决胜局里排第几个做决定，是赛前定的：取决于你是什么样的选手，而不是此刻多累，
   所以读裸 MEN 而非 eff()。 */
function penaltyKickerRound(s){const w=s.attrs.MEN;return w>=75?5:w>=55?3:1}
/* 稳打与等对面共用 .68 的基准，差别全在斜率与读哪条属性——不是配平出来的，
   是被 cond() 的量程逼出来的：form 55 时 fitness 归零也只把 cond 压到 .88
   （fitness 项量程仅 -0.12），75/75 的 build 因此只掉 6.3 点 effSHO / 3.6 点
   effWIL。要让「精力见底时等对面先动反超」成立，两者截距差必须小于 1.4/300+1.3/160
   ≈ .0128；给稳打留任何可见的先手都会把反超点推到 cond 够不着的地方。
   截距取平，反超落在 fitness≈34，正好是「精力见底」该有的位置。 */
function penaltyRate(s,o){
  const e=eff(s,o.stat);
  const base=o.id==="bold"?.58+(e-70)/200:o.id==="steady"?.68+(e-70)/160:.68+(e-70)/300;
  return clamp(base+(hasTalent(s,"big_heart")?.06:0),.35,.92);
}
function teamPenaltyRate(strength){return clamp(.72+(strength-74)/200,.55,.88)}
function newShootout(s,opp){
  return {round:1,myScore:0,oppScore:0,kicks:[],myRound:penaltyKickerRound(s),
    oppStrength:opp.strength,oppName:opp.name,sudden:false,done:false,won:null,myMiss:false};
}
/* 推进一轮：先中国后对手。轮到玩家主 C就原地返回，等 UI 拿选择回来。
   五波仍咬死则进加时（单次判定，不做多轮，避免流程冗长）。 */
function shootoutAdvance(s,so,rng){
  if(so.done||so.round===so.myRound)return so;
  const teamStrength=74+(overall(s)-72)*.72+(s.national.adapt||0)*.06;
  const mine=rng()<teamPenaltyRate(teamStrength);
  so.kicks.push({side:"me",round:so.round,scored:mine});
  if(mine)so.myScore++;
  const theirs=rng()<teamPenaltyRate(so.oppStrength);
  so.kicks.push({side:"opp",round:so.round,scored:theirs});
  if(theirs)so.oppScore++;
  so.round++;
  shootoutSettle(so);
  return so;
}
/* 五波结束后判定；仍然咬死就进加时标记，由 cupShootoutStep 收尾。 */
function shootoutSettle(so){
  if(so.round<=5)return;
  if(so.myScore!==so.oppScore){so.done=true;so.won=so.myScore>so.oppScore}
  else so.sudden=true;
}
function shootoutPlayerKick(s,so,optId,rng){
  const o=PENALTY_OPTIONS.find(x=>x.id===optId)||PENALTY_OPTIONS[1];
  const scored=rng()<penaltyRate(s,o);
  so.kicks.push({side:"me",round:so.round,scored,mine:true,opt:o.id});
  if(scored){so.myScore++;if(o.bold)change(s,"fame",4)}else so.myMiss=true;
  const theirs=rng()<teamPenaltyRate(so.oppStrength);
  so.kicks.push({side:"opp",round:so.round,scored:theirs});
  if(theirs)so.oppScore++;
  so.round++;
  shootoutSettle(so);
  return scored;
}
function cupMatchSim(s,opp,mentality,i,rng){
  const men={"稳守":{a:.85,d:.68},"均衡":{a:1,d:1},"强攻":{a:1.28,d:1.32}}[mentality]||{a:1,d:1};
  const team=74+(overall(s)-72)*.72+(s.national.adapt||0)*.06+(hasTalent(s,"red_shirt")?2:0)+(hasTalent(s,"big_heart")&&i>=3?3:0)+(hasTalent(s,"final_master")&&i===6?5:0);
  const edge=team-opp.strength+rndFloat(rng,-10,10);
  const {gf,ga}=toSeries(poisson(clamp((1.1+edge/16)*men.a,.18,3.6),rng),poisson(clamp((1.15-edge/20)*men.d,.18,3.4),rng),rng,i>=3?5:3);
  const player=overall(s);
  const goals=gf>0&&rng()<clamp(.30+(player-65)/80,.2,.75)?Math.min(gf,rng()<.18?2:1):0;
  const assists=(gf-goals>0&&rng()<.32)?1:0;
  let won=gf>ga,pen=false;
  if(i>=3&&gf===ga){pen=true;won=null}
  return {opp:opp.name,strength:opp.strength,gf,ga,goals,assists,won,pen,mentality,stage:i};
}
/* 读档后把进行中的S赛接回来。只要 shootout 还挂着就回决胜局，否则回到下一场。
   这里不能再看 done：最后一波打完时 done 已是 true，而结果弹窗还没点，
   saveGame() 恰好在这个空档存盘——漏掉它就等于把那场比赛的胜负永远丢在 null。
   done 的收尾由 cupShootoutStep 自己转交给 cupShootoutFinish。
   stage>6 或 alive 为假说明这届已经结束，直接清掉。 */
function resumeCup(s){
  const run=s&&s.national&&s.national.cupRun;
  if(!run||!run.alive){if(run)s.national.cupRun=null;return}
  if(run.stage>6){s.national.cupRun=null;return}
  if(run.shootout){cupShootoutStep(s);return}
  cupNext(s);
}
/* 决赛前夜。两个选择都对——这正是本作一贯的取舍手感，落在最该纠结的时刻。
   分手状态下换成周骁，避免出现一个不该出现的人。 */
function cupFinalEve(s){
  const together=["恋人","异地"].includes(s.relationship.status)||s.flags.married;
  if(together)return {title:"决赛前夜",portrait:"assets/chen-anan.webp",
    body:`<p>酒店的窗帘拉不严，走廊的灯从缝里透进来一条。你把手机拿起来又放下，放下又拿起来。</p><p>屏幕上是她三个小时前发的：<span class="dialogue">“睡了吗。”</span>你没回。</p>`,
    options:[
      option("给她打电话","状态+5，精力-6",()=>{change(s,"form",5);change(s,"fitness",-6)}),
      option("明天再说，先睡","精力+6",()=>{change(s,"fitness",6)})]};
  return {title:"决赛前夜",portrait:"assets/coach-zhou.webp",
    body:`<p>周骁的消息在凌晨一点进来，只有一句：<span class="dialogue">“十四岁那年你在铁丝网外面站了多久，还记得吗。”</span></p><p>你记得。你还记得那天他连头都没回。</p>`,
    options:[
      option("回他一条长的","状态+5，精力-6",()=>{change(s,"form",5);change(s,"fitness",-6)}),
      option("放下手机，先睡","精力+6",()=>{change(s,"fitness",6)})]};
}

/* 决胜局流程的唯一入口，也是刷新后的恢复点：每次都从当前 shootout 状态
   重新算该显示什么，因此中途刷新能原地接上。 */
function cupShootoutStep(s){
  const run=s.national.cupRun,so=run&&run.shootout;
  if(!so)return cupNext(s);
  const board=()=>`${cupFixtureBoard({name:so.oppName,strength:so.oppStrength},`决胜局 · 第${Math.min(so.round,5)}波${so.sudden?" · 加时":""}`,nationalStrength(s),s.club.name)}<div class="shootout-score"><span>${countryFlag(s.club.name)} ${esc(s.club.name)}</span><strong>${so.myScore} : ${so.oppScore}</strong><span>${countryFlag(so.oppName)} ${esc(so.oppName)}</span></div>`;
  if(so.done)return cupShootoutFinish(s);
  if(so.sudden){
    const p=clamp(.46+(eff(s,"MEN")-70)/260+(hasTalent(s,"big_heart")?.06:0),.25,.75);
    return enqueueFront({title:"加时：谁先崩谁输",body:`${board()}<p>五波交锋打完，双方还是咬死的。接下来没有第二次机会——谁先出错，谁回家。</p>`,
      options:[option("站到那个位置上","一波定生死",()=>{so.won=Math.random()<p;so.done=true;if(!so.won)so.myMiss=true;cupShootoutFinish(s)})]},"决胜局");
  }
  if(so.round===so.myRound){
    return enqueueFront({title:`第 ${so.round} 波 · 轮到你了`,
      body:`${board()}<p>决胜局，这一波轮到你来定。教练把选择权交了出来，语音里没有人说话。这几十秒里，观众席的声音忽然离你很远。</p>`,
      options:PENALTY_OPTIONS.map(o=>option(o.text,`成功率约 ${Math.round(penaltyRate(s,o)*100)}% · ${o.tip}`,()=>{
        shootoutPlayerKick(s,so,o.id,Math.random);cupShootoutStep(s);
      },o.bold?"danger":""))},"决胜局");
  }
  shootoutAdvance(s,so,Math.random);
  const last=so.kicks.slice(-2);
  enqueueFront({title:`决胜局 · 第 ${Math.min(so.round-1,5)} 波`,
    body:`${board()}<p>${last[0]&&last[0].scored?"队友把这一波稳稳打下来了。":"队友这一波崩了。"}${last[1]&&last[1].scored?"对面也拿下了他们那一波。":"对面这一波送了！"}</p>`,
    options:[option("继续","",()=>cupShootoutStep(s))]},"决胜局");
}
/* 决胜局结束：把胜负写回那场比赛，然后交还给正常的S赛流程。 */
function cupShootoutFinish(s){
  /* 认准 results 的最后一条，而不是 penMatch：存档往返会把两者拆成两个对象，
     那时写进 penMatch 的胜负是写给一个孤儿副本的，results 里会永远留着 won:null。
     决胜局期间不会再有别的比赛写进来，最后一条必然就是待决的这场。 */
  const run=s.national.cupRun,so=run.shootout,m=run.results[run.results.length-1]||run.penMatch;
  m.won=so.won;m.penScore=`${so.myScore}-${so.oppScore}`;
  /* cupPlayMatch 里那笔「赢下 +2 人气」是在 won 还是 null 时结算的，补在这里。 */
  if(so.won)change(s,"fame",2);
  if(so.myMiss)run.missedDecisivePenalty=!so.won;
  run.shootout=null;run.penMatch=null;
  const champion=m.stage===6&&m.won;
  enqueueFront({title:so.won?`决胜局 ${so.myScore}-${so.oppScore}，晋级！`:`决胜局 ${so.myScore}-${so.oppScore}，出局`,
    body:`<p>${so.won?"水晶炸开的瞬间，替补位上的人全冲了进来。":"你摘下耳机没有动。有人过来拍你的背，你没有抬头。"}</p>`,
    options:[option(champion?(run.cup==="msi"?"捧起MSI":"捧起召唤师奖杯"):so.won?"继续":"接受结果","",()=>{
      run.stage++;
      if(champion)cupFinish(s,true);
      else if(!so.won){run.alive=false;cupFinish(s,false)}
      else cupNext(s);
    })]},"决胜局");
}
function cupNext(s){const run=s.national.cupRun;if(!run||!run.alive)return;
  if(run.stage===6&&!run.eveShown){run.eveShown=true;const d=cupFinalEve(s);return enqueueFront({...d,options:d.options.map(o=>option(o.text,o.effect,()=>{o.apply();cupNext(s)}))},"决赛前夜")}
  cupKnockoutChoice(s);}
function cupKnockoutChoice(s){
  const run=s.national.cupRun,i=run.stage,cfg=cupCfg(s);
  const opp=i<3?run.group[i]:run.ko[i-3];
  enqueueFront({title:`${cfg.title} · ${CUP_STAGE_NAMES[i]} · 对阵 ${esc(opp.name)}`,
    body:`${cupFixtureBoard(opp,CUP_STAGE_NAMES[i],nationalStrength(s))}<p>对手 <b>${flagBadge(opp.name,opp.name,true)} ${esc(opp.name)}</b>。选择本场基调：</p><p class="dialogue">稳守：少丢也少进，利于以弱抗强、拖进决胜局；全力压上：击杀更多但后防更险；均衡：居中。</p>`,
    options:[option("稳守反打","降低双方节奏，利于爆冷",()=>cupPlayMatch(s,"稳守")),
      option("攻守均衡","中规中矩",()=>cupPlayMatch(s,"均衡")),
      option("全力压上","多击杀，风险更高",()=>cupPlayMatch(s,"强攻"))]},cfg.title);
}
function cupPlayMatch(s,mentality){
  const run=s.national.cupRun;run.mentality=mentality;
  const slot=(pickMoments(s,Math.random)||[])[0];
  const m=slot&&MOMENTS.find(x=>x.id===slot.id);
  if(!m){run.moments=[];run.choices=[];cupResolveMatch(s);return}
  run.moments=[slot];run.choices=[];
  const i=run.stage,opp=i<3?run.group[i]:run.ko[i-3],cfg=cupCfg(s);
  enqueueFront({title:momentHeadline(slot,m),
    body:`<p>${esc(m.body.replace("{minute}",slot.minute))}</p><p class="dialogue">${CUP_STAGE_NAMES[i]} · 对阵 ${esc(opp.name)}。</p>`,
    options:momentOptions(s,m).map((o,idx)=>{
      const p=Math.round(momentSuccessRate(s,m,o,opp.strength,false)*100);
      return option(o.text,`成功率约 ${p}% · ${o.tip}`,()=>{run.choices=[idx];cupResolveMatch(s)},
        o.risk==="bold"?"danger":o.risk==="safe"?"":"gold")})},"关键时刻");
}
function cupResolveMatch(s){
  const run=s.national.cupRun,i=run.stage,cfg=cupCfg(s),mentality=run.mentality||"均衡";
  const opp=i<3?run.group[i]:run.ko[i-3];
  const m=cupMatchSim(s,opp,mentality,i,Math.random);
  const p={gf:m.gf,ga:m.ga,goals:m.goals,assists:m.assists,keyWins:0,failures:0,timeline:[],
    moments:run.moments||[],choices:run.choices||[],oppStrength:opp.strength,plan:s.matchPlan||"carry"};
  resolveMoments(s,p,Math.random);
  m.gf=p.gf;m.ga=p.ga;m.goals=p.goals;m.assists=p.assists;m.momentLines=p.timeline;
  if(i>=3&&m.gf===m.ga){m.pen=true;m.won=null}else{m.pen=false;m.won=m.gf>m.ga;}
  run.moments=[];run.choices=[];
  s.national.caps++;s.statsCareer.nationalCaps++;s.national.goals+=m.goals;s.statsCareer.nationalGoals+=m.goals;
  if(m.goals)unlock("national_goal");
  change(s,"fitness",-10);change(s,"fame",m.goals*3+(m.won?2:0));
  run.results.push(m);
  if(m.pen&&m.won===null){run.shootout=newShootout(s,{name:m.opp,strength:m.strength});run.penMatch=m;cupShootoutStep(s);return}
  let advance;
  if(i<3){run.groupWins+=(m.gf>m.ga?1:0);run.groupPts+=(m.gf>m.ga?3:m.gf===m.ga?1:0);advance=i<2?true:(run.groupWins>=1||run.groupPts>=4)}
  else advance=m.won;
  const champion=i===6&&m.won;
  const resultLine=i>=3?(m.won?"晋级下一轮！":"止步于此。"):(i===2?(advance?"小组出线！":"小组赛出局。"):(m.gf>m.ga?"拿下三分。":m.gf===m.ga?"逼平对手。":"惜败。"));
  enqueueFront({title:`${CUP_STAGE_NAMES[i]} · ${esc(s.club.name)} ${m.gf}-${m.ga} ${esc(m.opp)}${m.pen?"（决胜局）":""}`,
    body:cupFixtureBoard({name:m.opp,strength:m.strength},CUP_STAGE_NAMES[i],nationalStrength(s),s.club.name)+`<div class="match-score"><span class="match-team">${flagBadge(s.club.name,s.club.name,true)} ${esc(s.club.name)}</span><strong>${m.gf} : ${m.ga}</strong><span class="match-team">${flagBadge(m.opp,m.opp,true)} ${esc(m.opp)}</span></div>`+
      `<div class="timeline-list">${(m.momentLines||[]).map(t=>`<div class="timeline-row"><b>${t.minute}'</b><span>${esc(t.text)}</span></div>`).join("")}</div>`+
      `<p>你拿下 <b>${m.goals}</b> 杀 ${m.assists} 助。${resultLine}</p><p class="dialogue">本场基调：${mentality}。</p>`,
    options:[option(champion?"捧起奖杯":advance?"继续":"接受结果","",()=>{
      run.stage++;if(champion)cupFinish(s,true);else if(!advance){run.alive=false;cupFinish(s,false)}else cupNext(s);})]},cfg.title);
}
/* 淘汰收尾。大多数玩家的S赛记忆是输，所以这条线不能是空收尾。
   输掉的那一局会被专门写出来。 */
function cupOutroScene(s){
  const run=s.national.cupRun,age=ageInfo(s).age,asian=!!(run&&run.cup==="msi");
  const gap=asian?2:4,again=age+gap<=diffOf(s).retireAge;
  const tail=asian
    ?(again?`两年后就是S赛。你${age+2}岁，还来得及。`:`两年后就是S赛。你${age+2}岁，你知道那意味着什么。`)
    :(again?`四年后你${age+4}岁。还来得及。`:`四年后你${age+4}岁。你知道那意味着什么。`);
  if(run&&run.missedDecisivePenalty)return {title:"那一脚",portrait:"assets/father.webp",
    body:`<p>休息室里没有人说话。有人在收键盘，收了很久也没收进包里。</p><p>你父亲的消息进来得很晚：<span class="dialogue">“我在电视上看见你走回去了。”</span>就这一句，没有别的。</p><p>${tail}</p>`};
  return {title:"回家的航班",portrait:"assets/chen-anan.webp",
    body:`<p>行李在传送带上转了两圈你才认出自己那个。出口外面人不多，她举着的牌子上什么也没写。</p><p>她说：<span class="dialogue">“我看完了。全部。”</span></p><p>${tail}</p>`};
}

function cupFinish(s,champion){
  const run=s.national.cupRun;
  const cfg=cupCfg(s);
  if(champion){s.honours.unshift({title:cfg.honour,season:ageInfo(s).season,icon:cfg.icon,detail:"国际赛事"});
    s.seasonStats.trophies++;unlock(cfg.achievement);change(s,"fame",cfg.champFame);
    if(run.cup==="msi")s.flags.asianChampion=true;else s.flags.worldChampion=true;}
  const short=["小组1","小组2","小组3","十六强","八强","半决赛","决赛"];
  const wcGoals=run.results.reduce((p,x)=>p+x.goals,0);
  enqueueFront({title:champion?(run.cup==="msi"?`${s.club.name}，季中之王！`:`${s.club.name}，世界冠军！`):`${cfg.title}之旅结束`,body:`<div class="cup-summary-head"><span class="flag-hero small" aria-hidden="true">${countryFlag(s.club.name)}</span><div><b>${esc(s.club.name)}</b><small>${cfg.title} · 本届战报</small></div></div><div class="story-list">${run.results.map(x=>`<div class="story-log"><time>${short[x.stage]}</time><div><h3>${flagBadge(s.club.name,s.club.name,true)} ${esc(s.club.name)} ${x.gf}-${x.ga} ${flagBadge(x.opp,x.opp,true)} ${esc(x.opp)}${x.pen?"（决胜局）":""}</h3><p>${x.stage>=3?(x.won?"晋级":"止步"):(x.gf>x.ga?"胜":x.gf===x.ga?"平":"负")} · 你 ${x.goals} 杀</p></div></div>`).join("")}</div><p>本届你出场 ${run.results.length} 场，拿下 <b>${wcGoals}</b> 个人头。${champion?'<span class="dialogue">从瑞士轮到决赛，你们一场一场赢到了最后。</span>':"明年还有一次。只是明年的你会大一岁。"}</p>`,options:[option(champion?"走上领奖台":"离开赛场","",()=>{
  if(champion){const trophy=run.cup==="msi"
    ?{title:"MSI",body:`<p>颁奖台比想象中矮，你上去的时候还差点踩空。奖杯递到手里，你才发现自己一直在笑，从终场响就没停过。</p><p>有人在你耳边喊了句什么，你没听清。你只想着一件事：这是我们的。</p>`}
    :{title:"召唤师奖杯",body:`<p>队长把奖杯递过来的时候你没有马上接。你先把手在队服上擦了两下——手心全是汗，你怕滑。</p><p>金属是凉的。比你想象中重。</p>`};
  return enqueueFront({title:trophy.title,body:`${trophyPortrait(run.cup)}${trophy.body}`,options:[option("找观众席","",()=>{
    enqueueFront({title:"观众席",portrait:"assets/father.webp",body:`<p>你在人群里一排排地找。找到的时候他正把眼镜摘下来擦，擦了很久。</p><p>旁边那个位置上的人一直在挥手，从终场响到现在，没停过。</p>`,options:[option("记住这一届","这一届会写进你的生涯",()=>{s.national.cupRun=null;if(s.cupCtx){const c=s.cupCtx;s.cupCtx=null;finishMonth(c)}})]},`${cfg.title}冠军`);
  })]},`${cfg.title}冠军`);}
  const sc=cupOutroScene(s);
  enqueueFront({...sc,options:[option("记住这一届","本届数据已更新",()=>{s.national.cupRun=null;if(s.cupCtx){const c=s.cupCtx;s.cupCtx=null;finishMonth(c)}})]},cfg.title);
})]},cfg.title);
}
function advanceMonth(force=false){if(!S||modalBusy||S.retired)return;if(S.actionPoints>0&&!force){const n=S.actionPoints;enqueueDecision({title:"还有执行点没有使用",body:`本月还剩 <b>${n}</b> 点。剩下的时间会自动用来休息：<b>精力 +${6*n}</b>、<b>伤病风险 −${3*n}</b>，但不会有任何属性成长。`,options:[option("继续安排本月","返回行动面板",()=>{}),option("休息，进入下个月",`精力+${6*n}，伤病风险−${3*n}`,()=>setTimeout(()=>advanceMonth(true),120))]},"时间确认");return}
  modalBusy=true;
  const _snap=S.monthSnap||{ov:overall(S),fit:S.fitness,form:S.form,love:S.relationship.love,family:S.family,money:S.money||0,age:ageInfo(S).age,inj:S.injury.months||0,st:S.relationship.status};
  if(S.actionPoints>0){const n=S.actionPoints;change(S,"fitness",6*n);S.injury.risk=Math.max(0,(S.injury.risk||0)-3*n);log(S,"story",`本月剩下的 ${n} 点时间没有排训练。你睡够了觉，手腕轻了一些。`)}
  S.totalMonth++;S.actionPoints=3;S.actionUsage={};S.combosHit=[];change(S,"fitness",16+Math.max(0,Math.round((60-S.fitness)*0.7)));
  // 每月状态只结算一次：向基线回归，外加恋爱与安家的小幅加成，合成一笔下发。
  // 基线由安安关系抬高——关系好不再折成隐形战力，而是让你的状态长期更稳；分手了，基线掉回 52。
  /* 状态每月回归基线。凡是「让你长期状态更好」的东西都必须抬高 base，
     绝不能写成一个每月固定 +N——那会把均衡点推高 N/0.22≈4.5N。
     合并前这些 +N 喂的是一个没有回归机制的旧字段，所以无害；直接搬到
     form 上会把均衡点顶到 67，四分之一的月份卡在 cond() 上限，
     状态管理就没意义了。关系的收益只走 loveSupport 一条路，不重复计。 */
  const base=52+loveSupport(S)+familySupport(S)+(S.assets&&S.assets.house?2:0);
  change(S,"form",Math.round((base-S.form)*0.22));
  S.peakOverall=Math.max(S.peakOverall||0,overall(S));S.lastActionFeedback=null;
  if(S.totalMonth%12===0&&ageInfo(S).age<=18){gain(S,"REA",.6,"growth");log(S,"story","又长了一岁。这个年纪反应还在往上走——这段窗口不会太久。")}
  const preSusp=S.suspension||0,preInjury=S.injury.months||0;
  S.offers.forEach(o=>o.months--);S.offers=S.offers.filter(o=>o.months>0);
  const a=ageInfo(S),justTurned16=S.totalMonth===24,justTurned18=S.totalMonth===48;
  if(justTurned16&&!S.flags.route16){enqueueDecision(routeChoice16(S),"16岁 · 生涯分流")}
  if(justTurned18)enterProAt18(S);
  if(a.age>=16&&S.salary>0){const d=diffOf(S),wage=Math.round(S.salary*d.income),expense=Math.round((1.5+S.fame/28)*d.expense);addMoney(S,wage-expense);if(S.debt>0&&S.totalMonth%6===0){S.debt=Math.round(S.debt*1.05);log(S,"warn","欠款利息又滚了一点，早点还清。")}}
  const passive=assetPassive(S);if(passive)addMoney(S,passive);if(S.assets&&S.assets.image_team&&S.totalMonth%3===0)change(S,"fame",1);
  ensureSchedule(S);
  /* 季后赛必须在打第一轮之前排好——排期要给两轮各抽一个不重复的对手。
     放在 finishMonth 里就晚了一个月：那时第1轮已经拿着 buildSchedule
     留下的空对手打完了，日程上会出现「主场对阵 」这种空档。 */
  {const wc=Math.ceil((S.totalMonth+2)/48)*48;
   if(S.national.called&&wc>=96&&S.totalMonth>=wc-12&&!(S.national.wcQual&&S.national.wcQual.wcMonth===wc)&&qualifierMonths(wc).some(m=>m>=S.totalMonth))scheduleQualifiers(S,wc);}
  /* 有排定的比赛但上不了场（伤停/雪藏/已退役）：在日程上标记 missed 留痕。
     不标的话这一场会永远停在 upcoming，变成「月份在过去却未开打」的幽灵场次，
     还会被 ensureSchedule 的 past 条件一路带进下个赛季。 */
  {const _fx=fixtureOfMonth(S);
   if(_fx&&(S.retired||!shouldPlayMatch(S))){_fx.status="missed";
     _fx.missReason=(S.injury.months||0)>0?`伤停·${S.injury.name||"伤病"}`:(S.flags&&S.flags.washedOut)?"被雪藏":"未出战";
     /* 你没上场，但战队不弃权：这一轮照样模拟，只是不带你的个人加成。
        不这么做，伤停三个月的玩家会看到自己战队场次比别人少三场。 */
     if(_fx.type==="club")advanceLeagueRound(S,{opponent:null,result:null},clubRoundOf(S,_fx.month));}}
  const _ctx={snap:_snap,preSusp,preInjury,justTurned16,matchReportModal:null};
  if(!S.retired&&shouldPlayMatch(S)){startMatchFlow(S,_ctx);return}
  finishMonth(_ctx);
}

/* 月末段。比赛可能跨越多次点击，所以从 advanceMonth 里拆出来当作续延。 */
function finishMonth(ctx){
  const _snap=ctx.snap,preSusp=ctx.preSusp,preInjury=ctx.preInjury,justTurned16=ctx.justTurned16,a=ageInfo(S);
  if(preSusp>0)S.suspension=Math.max(0,(S.suspension||0)-1);
  if(preInjury>0){S.injury.months=Math.max(0,S.injury.months-1);if(!S.injury.months){S.injury.name="";unlock("injury_return");log(S,"good","自然康复期结束，你重新进入比赛名单。")}}
  if(S.totalMonth%2===0&&!justTurned16){const e=chooseRandomEvent(S);if(e)queueEvent(S,e)}
  if(S.totalMonth%6===0&&STORY_BEATS[S.totalMonth])queueStory(S,STORY_BEATS[S.totalMonth](S));
  if(a.age>=18&&S.totalMonth%6===0&&!S.offers.length)generateOffers(S,S.flags.wantsMove?3:2);
  if(ctx.settleQual)settleQualifiers(S);
  const calledNow=nationalSelectionCheck(S);
  if(calledNow){queueNationalCall(S);ensureSchedule(S)}
  /* 没有「一屏跑完季后赛」的后路了。进不进得了正赛，由你自己打的那两轮决定；
     没赶上那两轮（比如刚被征召），这一届就与你无关——四年后再来。 */
  // 友谊赛已经是赛程上的 type:"national" 场次，由 startMatchFlow 驱动，这里不再另开一路。
  if(S.totalMonth%12===0){applyAging(S);const goalResult=evaluateSeasonGoal(S);
    /* 对位结算必须在 seasonAwardCheck 之前——它会把 seasonStats 清零。 */
    const rivalDuel=rivalSeasonSettle(S);
    queueAward(seasonAwardCheck(S),S,goalResult,rivalDuel);makeSeasonGoal(S);
    /* 评选完立刻把新赛季的榜建出来。校园/青训队的赛季首月没有比赛，
       不建的话上赛季的旧榜会一直挂到下一场联赛才换——期间玩家打开
       赛程页看到的还是旧赛季排名。宿敌同理：结算完立刻翻季。 */
    ensureLeague(S);ensureRival(S)}
  if(a.age>=16&&!S.retired&&!S.challenge&&!(S.flags&&S.flags.washedOut))queueChallengeChoice(S);
  riskSettlement(S);breakupCheck(S);intimateCheck(S);checkAchievements(S);updateRanking(S);
  /* 月度小结排到队尾：它是这个月的总账，必须在本月所有事件都点完之后才结算。
     body 用函数惰性求值——拼成字符串就等于在事件生效前抢跑，
     那些事件造成的属性变化永远进不了这张表。 */
  {const snapAtQueue=_snap;modalQueue.push({title:`${ageInfo(S).age}岁 · 第${ageInfo(S).month}月 · 月度小结`,kicker:"月度小结",body:()=>{const a2=ageInfo(S),rows=[],dd=(l,b,af,u="")=>{const v=Math.round((af-b)*10)/10;if(v)rows.push(`<div class="ms-row"><span>${l}</span><b style="color:${v>0?'var(--green)':'var(--bad)'}">${v>0?'+':''}${v}${u}</b></div>`)};dd("综合能力",snapAtQueue.ov,overall(S));dd("精力",snapAtQueue.fit,S.fitness);dd("状态",snapAtQueue.form,S.form);if(["恋人","异地"].includes(S.relationship.status))dd("安安关系",snapAtQueue.love,S.relationship.love);dd("家庭",snapAtQueue.family,S.family);dd("资金",snapAtQueue.money,S.money||0,"万");const extra=`${a2.age>snapAtQueue.age?`<p>🎂 你满 ${a2.age} 岁了。</p>`:""}${(S.injury.months||0)>snapAtQueue.inj?`<p style="color:var(--bad)">🩹 ${esc(S.injury.name)}，预计伤停 ${S.injury.months} 个月。</p>`:""}${snapAtQueue.st!=="分手"&&S.relationship.status==="分手"?`<p style="color:var(--bad)">💔 你和安安走散了。</p>`:""}`;return `${extra}<div class="month-summary">${rows.join("")||'<div class="ms-row"><span>这个月平平淡淡</span></div>'}</div>`},options:[option("确认，进入下月","",()=>{S.monthSnap={ov:overall(S),fit:S.fitness,form:S.form,love:S.relationship.love,family:S.family,money:S.money||0,age:ageInfo(S).age,inj:S.injury.months||0,st:S.relationship.status}})]})}
  if(ctx.matchReportModal)modalQueue.unshift(ctx.matchReportModal);   // 简报排到月度小结之前
  if(!S.retired){const r=shouldRetire(S);if(r){retirePlayer(S,r);saveGame();return}}
  modalBusy=false;saveGame();renderAll();setTimeout(pumpModal,0)}

/* ========== 比赛流程：赛前预告 → 2个关键时刻 → 结算 → 交回月末段 ========== */
/* 大赛月到了就开打。MSI不设预选赛直接进正赛；S赛只有出线了
   赛程上才会有这个条目（见 buildSchedule 的 qualifiedFor 判断）。
   cupCtx 挂在 state 上，是因为整届赛事跨很多次点击，最后要靠它把
   月末流程接回去；它只含纯数据，能安全进存档。 */
function startCupFinals(s,fx,ctx){
  s.cupCtx=ctx||null;
  const cup=fx.cup||"world",cfg=CUP_CONFIG[cup],d=cupDraw(Math.random,cfg);
  const scene=cup==="msi"?"assets/asian-cup-scene.webp":"assets/world-cup-scene.webp";
  s.national[cfg.counter]=(s.national[cfg.counter]||0)+1;
  s.national.cupRun={cup,stage:0,group:d.group,ko:d.ko,results:[],groupWins:0,groupPts:0,alive:true,moments:[],choices:[]};
  fx.status="played";fx.result={gf:0,ga:0,goals:0,assists:0,rating:0};
  enqueueFront({title:`${cfg.title} · 抽签之夜`,portrait:scene,
    body:`${cupOpeningCopy(cup,d,s.club.name)}<p>瑞士轮至少赢一场（或积满4分）即可出线；淘汰赛 BO5 定胜负，2-2 进决胜局。</p><p class="dialogue">这不是训练赛。从这一刻起，每一次 BP、每一个眼位，都会跟你的 ID 一起被记住。</p>`,
    options:[option("开始小组赛","",()=>cupNext(s))]},cfg.title);
}
function startMatchFlow(s,ctx){
  const fx=fixtureOfMonth(s);
  if(!fx){finishMonth(ctx);return}
  if(fx.type==="cup"){s.pendingMatch=null;modalBusy=false;startCupFinals(s,fx,ctx);return}
  /* 友谊赛仍是一屏出结果（不走预告/关键时刻），但它现在是赛程上的一场，
     结果要写回 fixture，日程页才看得到比分。 */
  if(fx.type==="national"){
    const r=simulateNationalMatch(s,Math.random,false,{name:fx.opponent,strength:fx.strength});
    fx.status="played";fx.result={gf:r.gf,ga:r.ga,goals:r.goals,assists:r.assists,rating:0};
    ctx.matchReportModal=null;queueNationalReport(r);finishMonth(ctx);return;
  }
  s.pendingMatch={stage:"preview",fixture:fx,ctx,index:0,pending:null};
  modalBusy=false;
  stepMatchPreview(s);
}
/* 赛前预告：先看清对手，再决定怎么打。
   三个选项就是本场职责——把行动页那个容易被忘掉的常驻设置搬到
   它真正起作用的时刻，且不比改动前多一次点击。 */
function startChance(s,opts={}){
  const club=opts.club||currentClub(s);
  return clamp(.42+(effOverall(s)-club.strength)/50+(s.coachFavor-50)/170+(hasTalent(s,"super_sub")?-.04:0),.15,.9);
}
/* 季后赛打的是你自己的战队。预告屏和 prepareMatch 必须取同一支队，
   否则预告显示的实力对比和首发率跟实际掷骰用的对不上，就是在骗玩家。 */
function fixtureClub(s,fx){
  return fx&&fx.type==="wcq"
    ?{name:s.club.name,league:"季后赛",strength:Math.round(nationalStrength(s))}
    :currentClub(s);
}
function stepMatchPreview(s){
  const pm=s.pendingMatch,fx=pm.fixture,club=fixtureClub(s,fx);
  const edge=club.strength-fx.strength,st=Math.round(startChance(s,{club})*100);
  const edgeText=edge>=6?"纸面占优":edge<=-6?"纸面下风":"势均力敌";
  enqueueFront({title:`${fx.competition} · ${fx.home?"主场":"客场"}对阵 ${esc(fx.opponent)}`,kicker:"赛前",
    body:`<div class="matchup-board"><div class="matchup-side">${teamStrengthBlock(club.name,club.strength,fx.home?"主场":"客场")}</div><div class="matchup-vs"><span>${esc(fx.competition)}</span><strong>VS</strong></div><div class="matchup-side">${teamStrengthBlock(fx.opponent,fx.strength,fx.home?"客队":"主队")}</div></div>`+
      `<p>${edgeText}。你的精力 <b>${Math.round(s.fitness)}</b>、状态 <b>${Math.round(s.form)}</b>，预计首发概率约 <b>${st}%</b>。</p>`+
      rivalEveLine(s,fx)+
      (s.seasonGoal?`<p class="dialogue">赛季目标：${esc(goalProgressText(s))}</p>`:"")+
      (s.challenge?`<p class="dialogue">教练挑战：${esc(s.challenge.text)}（${esc(challengeProgressText(s.challenge))}，剩余${Math.max(0,3-s.challenge.played)}场）</p>`:"")+
      `<p>本场你打算怎么打？</p>`,
    options:MATCH_PLANS.map(p=>option(`${p.icon} ${p.name}`,`${p.effects.join(" · ")}——${p.desc}`,()=>beginMatch(s,p.id)))},"赛前");
}
function beginMatch(s,plan){
  const pm=s.pendingMatch,fx=pm.fixture;
  s.matchPlan=plan;
  const club=fixtureClub(s,fx);
  pm.pending=prepareMatch(s,Math.random,{opponent:{name:fx.opponent,strength:fx.strength},
    home:fx.home,plan,competition:fx.competition,club});
  pm.stage="moments";
  if(!pm.pending.plays){resolveMatch(s);return}
  stepKeyMoment(s);
}
// 中断恢复：pumpModal 每次点击都存档，所以刷新页面必须能回到同一步。
function resumeMatchFlow(s){
  if(!s.pendingMatch)return false;
  modalBusy=false;
  if(s.pendingMatch.stage==="preview"||!s.pendingMatch.pending){stepMatchPreview(s);return true}
  if(!s.pendingMatch.pending.plays){resolveMatch(s);return true}
  stepKeyMoment(s);return true;
}
function stepKeyMoment(s){
  const pm=s.pendingMatch;if(!pm)return;
  const slot=pm.pending.moments[pm.index];
  if(!slot){resolveMatch(s);return}
  const m=MOMENTS.find(x=>x.id===slot.id);
  if(!m){pm.index++;stepKeyMoment(s);return}
  const behind=pm.pending.gf<pm.pending.ga,opts=momentOptions(s,m);
  enqueueFront({title:momentHeadline(slot,m),
    body:`<p>${esc(m.body.replace("{minute}",slot.minute))}</p><p class="dialogue">当前比分 ${pm.pending.club} ${pm.pending.gf}-${pm.pending.ga} ${pm.pending.opponent}。</p>`,
    options:opts.map((o,i)=>{
      const p=Math.round(momentSuccessRate(s,m,o,pm.pending.oppStrength,behind)*100);
      return option(o.text,`成功率约 ${p}% · ${o.tip}`,()=>{
        pm.pending.choices[pm.index]=i;pm.index++;saveGame();
        setTimeout(()=>stepKeyMoment(s),0);
      },o.risk==="bold"?"danger":o.risk==="safe"?"":"gold")
    })},"关键时刻");
}
function resolveMatch(s){
  const pm=s.pendingMatch;if(!pm)return;
  modalBusy=true;
  const ctx=pm.ctx,report=finishMatch(s,pm.pending);
  s.pendingMatch=null;
  applyMatch(s,report);
  /* 必须按 month 回查 s.schedule 里那个活对象，不能直接写 pm.fixture。
     saveGame 把 pendingMatch.fixture 和 schedule.fixtures[i] 序列化成两份，
     读档后它们就是两个对象；此时写 pm.fixture 等于写给一个孤儿副本，
     赛程上那场永远停在 upcoming，还会变成「月份在过去却未开打」的幽灵场次。
     决胜局的 penMatch 踩过一模一样的坑。 */
  if(pm.fixture){const fx=(s.schedule&&s.schedule.fixtures.find(f=>f.month===pm.fixture.month))||pm.fixture;
    fx.status="played";
    fx.result={gf:report.gf,ga:report.ga,goals:report.goals,assists:report.assists,rating:report.rating}}
  /* 联赛只认 type==="club" 的场次：大赛月你不在战队，那一轮不推进。
     玩家的真实比分直接传进去，不让联赛模块重算——榜、赛程页、比赛简报
     必须是同一个结果。 */
  if(pm.fixture&&pm.fixture.type==="club"){
    /* 对位只比联赛击杀：他的数字只有联赛，你的 seasonStats.goals 却混着
       杯赛和季后赛——拿总数比联赛，随机机器人都能七成赛季压过他。 */
    s.seasonStats.leagueGoals=(s.seasonStats.leagueGoals||0)+report.goals;
    /* 直接对话：对面是江彻的战队时，这一轮他的击杀会在 advanceLeagueRound
       里按份额算出来。赛后比一下——压过他状态+1，被他压过-1。
       数值刻意小，压力主要靠文案给（对位不进年度评选公式，避免平衡连锁）。 */
    const rvBefore=rivalActive(s)&&pm.fixture.opponent===s.rival.club.name?s.rival.goals:null;
    advanceLeagueRound(s,{opponent:pm.fixture.opponent,result:{gf:report.gf,ga:report.ga}},clubRoundOf(s,pm.fixture.month));
    if(rvBefore!==null){
      const his=s.rival.goals-rvBefore;
      if(report.goals>his){change(s,"form",1);log(s,"good",`同场较量：你${report.goals}杀，${RIVAL_NAME}${his}杀。这一晚的头条是你的。`)}
      else if(report.goals<his){change(s,"form",-1);log(s,"bad",`同场较量：${RIVAL_NAME}拿了${his}杀，你只有${report.goals}杀。他赛后没看你一眼。`)}
    }
  }
  if(pm.fixture&&pm.fixture.type==="wcq"&&s.national.wcQual){
    const q=s.national.wcQual;
    q.played++;q.points+=report.gf>report.ga?3:report.gf===report.ga?1:0;
    q.results.push({opp:report.opponent,gf:report.gf,ga:report.ga,goals:report.goals,assists:report.assists});
    s.national.caps++;s.statsCareer.nationalCaps++;
    s.national.goals+=report.goals;s.statsCareer.nationalGoals+=report.goals;
    if(report.goals)unlock("national_goal");
    if(q.played>=q.rounds)ctx.settleQual=true;
  }
  challengeProgress(s,report);
  ctx.matchReportModal={...buildMatchReportModal(report),kicker:report.classic?"经典之战":"比赛简报"};
  finishMonth(ctx);
}

function phaseCopy(s){const a=ageInfo(s).age,p=phaseOf(s);if(a<16)return["青训期","通过训练和内战争取留队"];if(a<18&&p==="firstteam")return["二队学徒期","训练赛、替补和队内竞争都要适应"];if(a<18&&p==="overseas")return["韩国青训期","先适应语言，再跟上训练强度"];if(a<18&&p==="campus")return["校园重启期","兼顾学业，为18岁的试训做准备"];return["职业生涯","转会、国际赛事和年度荣誉已经开放"]}

/* 七边形能力雷达。顶点顺序即 ATTRS 顺序，从正上方(-90°)顺时针每 360/7 度一个。
   R=64 时标签落在 x 36~204、y 22~193，均在 240×215 的 viewBox 内。 */
function radarSVG(s){
  const R=64,cx=120,cy=108,N=ATTRS.length;
  const pt=(i,k)=>{const t=(-90+i*360/N)*Math.PI/180;return[cx+R*k*Math.cos(t),cy+R*k*Math.sin(t)]};
  const ring=k=>ATTRS.map((_,i)=>pt(i,k).map(v=>v.toFixed(1)).join(",")).join(" ");
  let out=`<svg viewBox="0 0 240 215" width="100%" role="img" aria-label="能力雷达">`;
  [.25,.5,.75,1].forEach(k=>{out+=`<polygon points="${ring(k)}" fill="none" stroke="#ffffff${k===1?"28":"12"}" stroke-width="1"/>`});
  ATTRS.forEach((_,i)=>{const[x,y]=pt(i,1);out+=`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#ffffff12" stroke-width="1"/>`});
  const data=ATTRS.map((a,i)=>pt(i,clamp(s.attrs[a.key],1,99)/100));
  out+=`<polygon points="${data.map(p=>p.map(v=>v.toFixed(1)).join(",")).join(" ")}" fill="#0ac8b933" stroke="#0ac8b9" stroke-width="2" stroke-linejoin="round"/>`;
  data.forEach(([x,y])=>{out+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#0ac8b9"/>`});
  ATTRS.forEach((a,i)=>{
    const[x,y]=pt(i,1.34),mid=Math.abs(x-cx)<4,anchor=mid?"middle":(x>cx?"start":"end"),dx=mid?0:(x>cx?2:-2);
    out+=`<text x="${(x+dx).toFixed(1)}" y="${(y-2).toFixed(1)}" fill="#8fa3bd" font-size="8.5" font-weight="800" text-anchor="${anchor}">${a.key}</text>`;
    out+=`<text x="${(x+dx).toFixed(1)}" y="${(y+8).toFixed(1)}" fill="#f0f4f8" font-size="13" font-weight="900" text-anchor="${anchor}">${Math.round(s.attrs[a.key])}</text>`;
  });
  return out+`</svg>`;
}
function renderAll(){if(!S||typeof document==="undefined")return;const a=ageInfo(S),[phase,hint]=phaseCopy(S);$("playerNameText").textContent=S.name;$("clubText").textContent=`${S.club.name} · ${S.club.league}`;{const pb=$("posBadge");if(pb)pb.textContent=posOf(S).chip}$("overallText").textContent=overall(S);$("radarOvr").textContent=overall(S);$("ageText").textContent=`${a.age}岁`;$("monthText").textContent=`第${a.month}月`;$("apText").textContent=`${S.actionPoints} / 3`;$("careerSubtitle").textContent=`第${a.season}赛季 · ${phase}`;$("phaseTitle").textContent=phase;$("phaseHint").textContent=`${hint} · ${S.totalMonth%2===0?"两个月后触发抉择":"下个月触发两月抉择"}`;{const el=$("nextMatch");if(el){ensureSchedule(S);const nf=nextFixture(S);
    if(S.injury.months>0)el.innerHTML=`<span class="nm-when">伤停中 · 预计 ${S.injury.months} 个月后复出</span>`;
    else if(!nf)el.innerHTML=`<span class="nm-when">本赛季赛程已打完</span>`;
    else{const n=fixtureCountdown(S,nf);
      el.innerHTML=`下一场 · ${nf.home?"主场":"客场"} vs <b>${esc(nf.opponent)}</b>`+
        `<span class="nm-when">（${esc(nf.competition)}） · ${n<=0?"本月末":`还有 ${n} 个月`}</span>`}}}$("fitnessText").textContent=Math.round(S.fitness);$("formText").textContent=Math.round(S.form);$("loveText").textContent=S.relationship.status==="分手"?"—":Math.round(S.relationship.love);$("fitnessBar").style.width=`${S.fitness}%`;$("formBar").style.width=`${S.form}%`;$("loveBar").style.width=`${S.relationship.love}%`;{const ft=$("familyText"),fb=$("familyBar");if(ft)ft.textContent=Math.round(S.family);if(fb)fb.style.width=`${S.family}%`}const moneyEl=$("moneyText");if(moneyEl){moneyEl.textContent=`${Math.round(S.money)}万`;moneyEl.style.color=S.money<0?"var(--bad)":"var(--gold)"}
  $("talentMini").innerHTML=S.talents.map(id=>`<span>${esc(talentById(id)?.name||id)}</span>`).join("");$("radarPanel").innerHTML=radarSVG(S);
  document.querySelectorAll("#gameNav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===S.tab));renderTab();}

function renderTab(){const fn={actions:renderActions,story:renderStory,career:renderCareer,matches:renderMatches,transfer:renderTransfer,assets:renderAssets,national:renderNational,honours:renderHonours,rank:renderRank}[S.tab]||renderActions;fn()}
function renderAssets(){const d=diffOf(S),wage=S.salary>0?Math.round(S.salary*d.income):0,expense=S.salary>0?Math.round((1.5+S.fame/28)*d.expense):0,passive=assetPassive(S),net=wage-expense+passive,tm=Math.round((trainMult(S)-1)*100),inj=Math.round((1-assetInjuryFactor(S))*100);
  const card=it=>{const owned=ownedAsset(S,it.id),lock=owned?null:assetLocked(S,it),broke=!owned&&!lock&&S.money<it.cost,disabled=owned||lock||broke;return`<article class="action-card ${owned?"used":""}"><div class="action-icon">${it.icon}</div><h3>${esc(it.name)}</h3><p>${esc(it.desc)}</p><div class="effect-line"><span>${esc(it.effect)}</span><span>${it.cost}万</span></div><button data-buy="${it.id}" ${disabled?"disabled":""}>${owned?"已拥有":lock?esc(lock):broke?`资金不足 · 需${it.cost}万`:`购买 · ${it.cost}万`}</button></article>`};
  const sections=ASSET_CATS.map(cat=>{const items=ASSETS.filter(a=>a.cat===cat);if(!items.length)return"";return`<div class="section-head"><h2>${esc(cat)}</h2><span>${items.filter(a=>ownedAsset(S,a.id)).length}/${items.length}</span></div><div class="action-grid">${items.map(card).join("")}</div>`}).join("");
  $("panel").innerHTML=`<section class="hero-panel"><span class="eyebrow">MONEY & ASSETS</span><h2>你的账户与资产</h2><p>钱来自合同月薪、比赛奖金、直播分成、代言和投资分红；用于礼物、家用、手部康复和下面的资产。资金、资产都计入生涯积分，欠款拉低积分。越贵的东西往往要靠年龄、人气或先置资产解锁——攒钱吧。</p>${heroMetrics([[`${Math.round(S.money)}万`,"个人资金"],[`${net>=0?"+":""}${net}/月`,"每月净收入"],[`+${passive}/月`,"投资被动收入"],[`+${tm}% · -${inj}%`,"训练加成 · 伤病"]])}</section>${sections}<div class="section-head"><h2>赚钱与花钱的入口</h2><span>大多在“行动”页</span></div><article class="info-card"><p>· 赚钱：击杀助攻、媒体安排、赛季目标奖金、转会签字费、投资被动收入。<br>· 花钱：给安安买礼物、贴补家用、专业康复，以及本页资产。<br>· 提示：月薪按合同逐月发，生活开销随名气上涨；欠款每半年计息，尽早还清。</p></article>`;
  $("panel").querySelectorAll("[data-buy]").forEach(b=>b.addEventListener("click",()=>{if(buyAsset(S,b.dataset.buy)){toast("到手了");saveGame();renderAll()}else toast("买不了：资金或条件不足")}))}
function heroMetrics(items){return`<div class="metric-grid">${items.map(x=>`<div class="metric"><b>${esc(x[0])}</b><span>${esc(x[1])}</span></div>`).join("")}</div>`}

function renderActions(){const phase=phaseOf(S),available=ACTIONS.filter(a=>a.phases.includes(phase)&&(!a.show||a.show(S)));$("panel").innerHTML=`<section class="hero-panel"><span class="eyebrow">MONTHLY PLAN</span><h2>${esc(S.name)}，这个月你想怎么过？</h2><p>同一种行动每月最多执行${phase==="academy"?"一到两次":"两次"}。天赋会影响成功率和收益，但每种选择都有取舍。<span class="diff-inline">${esc(diffOf(S).name)}难度</span></p>${S.seasonGoal?`<div class="goal-banner"><span class="eyebrow">本赛季目标</span>${esc(goalProgressText(S))}</div>`:""}${S.challenge?`<div class="goal-banner challenge-banner"><span class="eyebrow">教练挑战 · ${esc((CHALLENGE_TIERS.find(t=>t.tier===S.challenge.tier)||{}).name||"")}</span>${esc(S.challenge.text)}<small>进度：${esc(challengeProgressText(S.challenge))}｜剩余${Math.max(0,3-S.challenge.played)}场</small></div>`:""}${heroMetrics([[`${S.actionPoints}/3`,"剩余执行点"],[overall(S),"综合能力"],[Math.round(S.coachFavor),"教练信任"],[S.injury.months?`${S.injury.months}月`:"健康","伤停状态"]])}</section>${S.lastActionFeedback?`<div class="feedback-banner"><span class="eyebrow">${esc(S.lastActionFeedback.name)}</span><p>${esc(S.lastActionFeedback.text)}</p><small>${esc(S.lastActionFeedback.effects)}</small></div>`:""}<div class="section-head"><h2>本月行动</h2><span>${available.length}项可选 · 点击即消耗1点</span></div><div class="action-grid">${available.map(a=>{const used=S.actionUsage[a.id]||0,broke=a.cost&&(S.money||0)<a.cost,injuredLock=S.injury.months>0&&!['recover','home','english','love_time','gift'].includes(a.id),disabled=S.actionPoints<=0||used>=a.max||broke||injuredLock;return`<article class="action-card ${used?"used":""}"><div class="action-icon">${a.icon}</div><h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p><div class="effect-line">${a.effects.map(e=>`<span>${esc(e)}</span>`).join("")}</div><button data-action-id="${a.id}" ${disabled?"disabled":""}>${used>=a.max?"本月已完成":broke?`资金不足 · 需${a.cost}万`:injuredLock?"伤停不可用":used>0?"再练一次 · 收益60%":"执行 · 1点"}</button></article>`}).join("")}</div>`;$("panel").querySelectorAll("[data-action-id]").forEach(b=>b.addEventListener("click",()=>applyAction(b.dataset.actionId)));}

function renderStory(){const married=!!(S.flags&&S.flags.married);const relation=married?"你们成家了。她还是有自己的事业，你还是每天坐在那个位置上，但如今每天回去，有个人在等你。":S.relationship.status==="分手"?"你们已经分开，关系值不再变化，但共同经历仍留在生涯记录里。":S.relationship.status==="异地"?"隔着这么远还没散，可每次谁都不先开口，心就更远一点。":"她有自己的学业和生活，不可能一直围着你的比赛转。";$("panel").innerHTML=`<section class="hero-panel relation-card"><img src="${asset("assets/chen-anan.webp")}" alt="陈安安"><div><span class="eyebrow">陈安安 · ${esc(married?"已婚":S.relationship.status)}</span><h2>${S.relationship.status==="分手"?"你们回到了各自的人生":`关系值 ${Math.round(S.relationship.love)}`}</h2><p class="quote">${relation}</p><div class="bar-label"><span>亲密与信任</span><b>${Math.round(S.relationship.love)}/100</b></div><div class="bar-wide"><i style="width:${S.relationship.love}%"></i></div>${S.relationship.status!=="分手"?`<div class="effect-line"><span>状态基线 +${loveSupport(S)}</span><span>每月状态 +${S.relationship.love>=65?2:1}</span><span>关系越高，状态越稳</span></div>`:""}</div></section><div class="section-head"><h2>人生记录</h2><span>最近${Math.min(30,S.log.length)}条</span></div><div class="story-list">${S.log.slice(0,30).map(l=>{const ai={age:14+Math.floor(l.month/12),month:l.month%12+1};return`<article class="story-log"><time>${ai.age}岁·${ai.month}月</time><div><h3>${l.kind==="action"?"行动":l.kind==="good"?"好消息":l.kind==="bad"?"代价":"故事"}</h3><p>${esc(l.text)}</p></div></article>`}).join("")}</div>`}

function renderCareer(){const a=ageInfo(S),c=S.statsCareer,winRate=c.matches?Math.round(c.wins/c.matches*100):0;$("panel").innerHTML=`<section class="hero-panel"><span class="eyebrow">CAREER FILE</span><h2>${esc(S.name)} · ${posName(S)}</h2><p>${esc(S.club.name)}，${a.age}岁，${posName(S)}。你能走多远，不只看最高属性；出勤、状态和每次选择也算数。</p>${heroMetrics([[c.matches,"正式比赛"],[c.goals,"生涯击杀"],[c.assists,"生涯助攻"],[`${winRate}%`,"胜率"]])}</section><div class="career-grid"><article class="info-card path-card"><h3>生涯时间线</h3><div class="path-line"><b>14岁 · CQG 青训队</b><span>进入当地战队的青训体系</span></div><div class="path-line"><b>16岁 · ${S.flags.route16?S.route==="overseas"?"赴韩青训":S.route==="campus"?"回到校园":"升入二队":"尚未发生"}</b><span>${S.flags.route16?S.route==="overseas"?"与安安异地，独自适应韩服和韩语":S.route==="campus"?"保留感情与学业，等待第二次机会":"在熟悉的城市从二队打起":"16岁评估后决定去向"}</span></div><div class="path-line"><b>18岁 · ${S.flags.pro18?`效力${esc(S.club.name)}`:"转会市场尚未开放"}</b><span>${S.flags.pro18?"职业合同、转会与国际赛事系统开放":"继续积累实力、人气与教练信任"}</span></div></article>${rivalCardHTML(S)}<article class="info-card"><h3>七项主属性</h3><div class="effect-line">${ATTRS.map(a=>`<span>${a.key} ${esc(a.name)} ${Math.round(S.attrs[a.key])}</span>`).join("")}<span>语言 ${Math.round(S.language)}</span><span>人气 ${Math.round(S.fame)}</span><span>分路 ${posName(S)}</span></div><p>七项都是真实数值，行动、比赛结果与击杀判定全部由它们决定；状态与精力作为动态系数同时介入——精力见底时反应和操作掉得最狠，心态几乎不受影响。分路只改这七项在综合评分里的权重：同样一套属性，放在中单和辅助身上值的钱完全不同。当前生涯积分 <b>${careerScore(S)}</b>。</p></article><article class="info-card style-card"><h3>流派（后天打法）</h3><p>天赋是出生带来的，流派是练出来的。流派等级抬高对应属性的成长天花板——没有流派兜着的属性练到 88 左右就基本爬不动了。心态不归任何流派，它只从剧情和压力里长。</p>${STYLES.map(st=>{const exp=(S.styles&&S.styles[st.key])||0,lv=styleLevel(exp),next=styleNext(exp),pct=Math.min(100,Math.round(exp/next*100));return `<div class="style-row ${lv?"":"dim"}"><div class="style-head"><b>${st.icon} ${esc(st.name)} <small>${st.attrs.join("·")}</small></b><span class="style-lv">${lv?STYLE_NUMERALS[lv-1]+"级":"未入门"}</span></div><div class="bar-wide"><i style="width:${pct}%"></i></div><div class="bar-label"><span>${esc(lv?st.levels[lv-1]:st.desc)}</span><span>${Math.round(exp)}${lv<3?" / "+next:""}</span></div></div>`}).join("")}</article></div><div class="section-head"><h2>转会履历</h2><span>${S.transfers.length}次</span></div>${S.transfers.length?`<div class="card-list">${S.transfers.map(t=>`<article class="info-card"><h3>${esc(t.from)} → ${esc(t.to)}</h3><p>${14+Math.floor(t.month/12)}岁 · 转会费${t.fee}万 · ${esc(t.role)}</p></article>`).join("")}</div>`:'<div class="empty-state">尚未完成正式转会。</div>'}`}

function matchCard(m){return`<article class="info-card match-card ${m.classic?"classic":""}"><span class="eyebrow">${esc(m.competition)} · ${m.role}</span><div class="match-score"><span class="match-team">${esc(m.club)}</span><strong>${m.gf}:${m.ga}</strong><span class="match-team">${esc(m.opponent)}</span></div><div class="effect-line"><span>评分 ${m.rating||"—"}</span><span>${m.goals}杀</span><span>${m.assists}助</span><span>${m.home?"主场":"客场"}</span></div><div class="timeline-list">${m.timeline.slice(-4).map(t=>`<div class="timeline-row"><b>${t.minute}'</b><span>${esc(t.text)}</span></div>`).join("")}</div></article>`}
/* 三种状态各有各的显示：打过的给比分，伤停/雪藏的给原因，未打的给倒计时。
   倒计时必须走 fixtureCountdown——直接写 f.month-cur 会差一位，
   而且 missed 的场次月份在过去，减出来是负的，会渲染成「-5个月后」。 */
/* 青训队一季只有3轮、校园5轮，名次噪声很大。标题里标出「第N轮/共M轮」，
   让玩家知道样本就这么小，而不是以为自己稳居第4。 */
function leagueTableHTML(s){
  const lg=ensureLeague(s);
  if(!lg||!lg.teams.length)return"";
  const rows=leagueStandings(lg).map((x,i)=>{
    const me=x.name===s.club.name,gd=x.gf-x.ga;
    return `<tr class="${me?"me":""}"><td>${i+1}</td>`+
      `<td>${esc(x.name)}${me?'<span class="lt-you">你</span>':""}</td>`+
      `<td>${x.p}</td><td>${x.w}-${x.l}</td>`+
      `<td>${gd>0?"+":""}${gd}</td><td>${x.pts}</td></tr>`;
  }).join("");
  return `<div class="section-head"><h2>本赛季 · ${esc(s.club.league)}</h2>`+
    `<span>第 ${Math.max(1,lg.played)} 轮 / 共 ${lg.rounds} 轮</span></div>`+
    `<table class="rank-table league-table"><thead><tr>`+
    `<th>#</th><th>战队</th><th>场</th><th>胜负</th><th>净胜小分</th><th>积分</th>`+
    `</tr></thead><tbody>${rows}</tbody></table>`;
}
function fixtureRow(f,cur,nextMonth){
  /* 赛季收官那一行不是比赛：没有对手、没有比分，只标个时间点。
     跟比赛行走同一套排版会渲染出「客 vs 」和「0 : 0」这种鬼话。 */
  if(f.type==="award"){
    const n=fixtureCountdown({totalMonth:cur},f),age=14+Math.floor(f.month/12),mon=f.month%12+1;
    return `<div class="fixture-row award ${f.month<cur?"done":""}">`+
      `<div class="fx-when">${age}岁<br>第${mon}月</div>`+
      `<div class="fx-opp"><b>${esc(f.competition)}</b>`+
      `<span class="fx-meta">年度评选、赛季目标结算与年龄增长都在这一刻</span></div>`+
      `<div class="fx-score pending">${f.month<cur?"已结算":n<=0?"本月末":`${n}个月后`}</div></div>`;
  }
  const done=f.status==="played"&&f.result,missed=f.status==="missed",r=f.result;
  const cls=done?(r.gf>r.ga?"win":r.gf<r.ga?"loss":""):missed?"miss":"pending";
  const n=fixtureCountdown({totalMonth:cur},f);
  const score=done?`${r.gf} : ${r.ga}`:missed?"未出战":n<=0?"本月末":`${n}个月后`;
  const age=14+Math.floor(f.month/12),mon=f.month%12+1;
  const tail=done?` · 你 ${r.goals}杀 ${r.assists}助 · 评分 ${r.rating||"—"}`
    :missed?` · ${esc(f.missReason||"未出战")}`
    :` · ${starRating(f.strength,{small:true})}`;
  return `<div class="fixture-row ${f.month===nextMonth?"now":""} ${done||missed?"done":""}">`+
    `<div class="fx-when">${age}岁<br>第${mon}月</div>`+
    `<div class="fx-opp"><b>${f.home?"主":"客"} vs ${esc(f.opponent||(f.type==="wcq"?"待抽签":"—"))}</b>`+
    `<span class="fx-meta">${esc(f.competition)}${tail}</span></div>`+
    `<div class="fx-score ${cls}">${score}</div></div>`;
}
function renderMatches(){
  const c=S.statsCareer;ensureSchedule(S);
  const fx=(S.schedule&&S.schedule.fixtures)||[],played=fx.filter(f=>f.status==="played").length;
  $("panel").innerHTML=`<section class="hero-panel"><span class="eyebrow">FIXTURES</span><h2>强不等于稳赢</h2><p>能力越高，发挥通常越稳；但状态、疲劳、伤停、对手强弱和临场运气都会影响结果。赛程在赛季初就排定，你可以提前为硬仗调整精力与状态。</p>${heroMetrics([[`${played}/${fx.length}`,"本赛季已打"],[c.goals,"生涯击杀"],[c.matches,"生涯出场"],[c.bestRating.toFixed?.(1)||c.bestRating,"最佳评分"]])}</section>`+
    leagueTableHTML(S)+
    `<div class="section-head"><h2>本赛季日程</h2><span>第${ageInfo(S).season}赛季 · ${fx.length}场</span></div>`+
    `<div class="card-list">${fx.length?(()=>{const nf=nextFixture(S);return fx.map(f=>fixtureRow(f,S.totalMonth,nf&&nf.month)).join("")})():'<div class="empty-state">赛程尚未排定。</div>'}</div>`+
    `<div class="section-head"><h2>最近比赛</h2><span>${S.matches.length}场已归档</span></div>`+
    `<div class="card-list">${S.matches.length?S.matches.slice(0,12).map(matchCard).join(""):'<div class="empty-state">结束月份后，第一场简报会出现在这里。</div>'}</div>`;
}

function renderTransfer(){if(ageInfo(S).age<18){$("panel").innerHTML=`<div class="locked-panel"><div class="lock">⌁</div><h2>转会市场将在18岁开放</h2><p>16岁的选择会影响职业起点。即使回到校园，18岁时仍有机会参加职业试训。</p></div>`;return}$("panel").innerHTML=`<section class="hero-panel"><span class="eyebrow">TRANSFER MARKET</span><h2>${esc(S.club.name)} · 身价约 ${Math.max(120,Math.round((overall(S)-50)*38+S.fame*8))}万</h2><p>报价会参考能力、年龄、人气、赛季数据和天赋。战队越强，比赛强度越高，首发也越难拿。个人资金可以用来给安安买礼物、贴补家用和专业康复，也会计入生涯积分。${S.debt?`<br><b>当前欠款 ${S.debt} 万</b>，会拉低生涯积分，记得用工资或“贴补家用”还清。`:""}</p>${heroMetrics([[overall(S),"综合能力"],[Math.round(S.fame),"人气"],[S.offers.length,"有效报价"],[`${Math.round(S.money)}万`,"个人资金"]])}</section><div class="section-head"><h2>收到的报价</h2><button id="askOffers" class="small-button" ${S.actionPoints<1?"disabled":""}>联系经纪人 · 1点</button></div><div class="card-list">${S.offers.length?S.offers.map(o=>`<article class="offer-card"><div><span class="eyebrow">${esc(o.league)} · ${esc(o.role)}</span><h3>${esc(o.club)}</h3><p>战队强度 ${o.strength} · 转会费 ${o.fee}万 · 报价剩余${o.months}个月</p><div class="offer-actions"><button class="small-button" data-offer="${o.id}">接受报价</button></div></div><div class="salary"><b>${o.salary}万</b><br><span class="tag">月薪</span></div></article>`).join(""):'<div class="empty-state">当前没有有效报价。每半年会自动刷新，也可以消耗1点联系经纪人。</div>'}</div>`;$("askOffers")?.addEventListener("click",()=>{if(S.actionPoints<1)return;S.actionPoints--;generateOffers(S,3);log(S,"action","联系经纪人了解转会市场。");saveGame();renderAll()});$("panel").querySelectorAll("[data-offer]").forEach(b=>b.addEventListener("click",()=>{enqueueDecision({title:"确认完成转会？",body:`离开${esc(S.club.name)}后，现有教练信任与首发顺位会重新计算。`,options:[option("签署合同","转会立即生效",()=>acceptOffer(S,b.dataset.offer),"gold"),option("再考虑一下","报价继续保留",()=>{})]},"转会确认")}))}

function renderNational(){if(!S.national.called){const avg=S.seasonStats.matches?S.seasonStats.ratingTotal/S.seasonStats.matches:0;$("panel").innerHTML=`<div class="locked-panel"><div class="lock">★</div><h2>国际赛场的门还没打开</h2><p>要想跟着战队出国打比赛，你得先在联赛里站住。当前${esc(diffOf(S).name)}难度下，通常需要综合能力达到 ${(hasTalent(S,"red_shirt")?71:74)+diffOf(S).threshold}，并保持赛季平均评分 ${(6.7+diffOf(S).threshold*.02).toFixed(1)} 以上。当前能力 ${overall(S)}，赛季平均 ${avg?avg.toFixed(1):"—"}。</p></div>`;return}$("panel").innerHTML=`<section class="hero-panel"><span class="eyebrow">INTERNATIONAL</span><h2>飞出去打的那几周</h2><p>MSI 每年第6月，S 赛每年第11月——但 S 赛的门票要靠夏季赛季后赛自己打下来。国际赛期间你不在联赛赛程上，也更容易累垮。</p>${heroMetrics([[S.national.caps,"国际赛出场"],[S.national.goals,"国际赛击杀"],[Math.round(S.national.adapt),"版本适应"],[S.national.worldCups,"S赛次数"]])}</section><div class="section-head"><h2>赛制说明</h2><span>MSI 与 S 赛每年各一届</span></div><article class="info-card"><h3>S 赛怎么打</h3><p>每年第8、9月是<b>夏季赛季后赛</b>两轮，积分够才拿得到门票；拿到门票后<b>随机抽签</b>，逐场进行<b>瑞士轮</b>与<b>淘汰赛</b>；淘汰赛前可选<b>临场基调</b>（稳守／均衡／强攻）左右赔率，2-2 进决胜局，一路赢到底就是世界冠军。</p></article><article class="info-card"><h3>你在队里的角色</h3><p>${overall(S)>=90?"世界级核心，战队会围绕你的节奏来配英雄。":overall(S)>=82?"稳定首发，有能力左右赛区级别的强强对话。":"轮换选手，需要在有限的上场机会里证明自己。"}${S.flags.outOfPosition?" 教练还会把你安排到不熟悉的位置上。":""}</p><div class="effect-line"><span>${esc(posName(S))}</span><span>${hasTalent(S,"red_shirt")?"为国出征天赋":"常规入选"}</span><span>${S.flags.captain?"队长候选":"竞争队内地位"}</span></div></article>`}

function renderHonours(){const c=S.statsCareer;$("panel").innerHTML=`<section class="hero-panel"><span class="eyebrow">TROPHY ROOM</span><h2>你的奖杯和纪录</h2><p>奖杯、成就和生涯数据都会保存在本地。年度最佳选手会综合赛季击杀、助攻、平均评分、联赛级别、国际赛表现和团队荣誉。</p>${heroMetrics([[S.honours.length,"奖杯与大赛荣誉"],[S.awards.length,"年度最佳选手"],[c.goals,"生涯击杀"],[c.assists,"生涯助攻"]])}</section><div class="section-head"><h2>奖杯陈列室</h2><span>${S.honours.length}件</span></div>${S.honours.length?`<div class="trophy-shelf">${S.honours.map(h=>`<article class="honour-card"><div class="trophy-icon">${esc(h.icon||"♛")}</div><b>${esc(h.title)}</b><span>第${h.season}赛季 · ${esc(h.detail||"")}</span></article>`).join("")}</div>`:'<div class="empty-state">奖杯架还空着。真正的职业生涯刚刚开始。</div>'}<div class="section-head"><h2>成就系统</h2><span>${Object.keys(META.unlocked).length}/${ACHIEVEMENTS.length}</span></div><div class="achievement-grid">${ACHIEVEMENTS.map(a=>`<article class="achievement-card ${META.unlocked[a.id]?"":"locked"}"><div class="ach-icon">${a.icon}</div><div><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div></article>`).join("")}</div>`}

function renderRank(){updateRanking(S);const rankings=META.rankings;$("panel").innerHTML=`<section class="hero-panel"><span class="eyebrow">LOCAL LEGENDS</span><h2>这台设备上的峡谷传奇</h2><p>排行只保存在本地浏览器，不上传姓名或存档。每个赛季和关键结算都会更新当前生涯的最好成绩。</p>${heroMetrics([[careerScore(S),"当前积分"],[rankings.findIndex(x=>x.runId===S.runId)+1||"—","本地名次"],[META.runs,"开档次数"],[Object.keys(META.unlocked).length,"已解锁成就"]])}</section><div class="section-head"><h2>本地生涯排行</h2><span>最多保留10档</span></div><article class="rank-card"><table class="rank-table"><thead><tr><th>排名</th><th>选手</th><th>战队</th><th>年龄</th><th>击杀</th><th>积分</th></tr></thead><tbody>${rankings.map((r,i)=>`<tr class="${r.runId===S.runId?"me":""}"><td>${i+1}</td><td>${esc(r.name)}</td><td>${esc(r.club)}</td><td>${r.age}</td><td>${r.goals}</td><td><b>${r.score}</b></td></tr>`).join("")}</tbody></table></article>`}

function randomTalents(){return TALENTS.slice().sort(()=>Math.random()-.5).slice(0,3).map(t=>t.id)}
function renderCreator(){const left=ALLOC_BUDGET-Object.values(creatorAllocation).reduce((a,b)=>a+b,0);$("pointsLeft").textContent=left;
/* 分路卡的权重全部从 POSITIONS 现算，出身卡的修正全部从 ORIGIN_TIERS 现算——
   界面上不另抄一份数字，改表即改界面。 */
{const pos=POSITIONS.find(p=>p.key===creatorPosition)||POSITIONS[2];
 $("positionPicker").innerHTML=POSITIONS.map(p=>{
   const top=Object.entries(p.w).sort((a,b)=>b[1]-a[1]).slice(0,3)
     .map(([k])=>ATTRS.find(x=>x.key===k).name).join(" · ");
   return `<button class="pos-card ${creatorPosition===p.key?"active":""}" type="button" data-pos="${p.key}"><span class="pos-chip">${p.chip}</span><b>${esc(p.name)}</b><span class="pos-sub">${esc(p.sub)}</span><p>${esc(top)}</p></button>`}).join("");
 $("positionPicker").querySelectorAll("[data-pos]").forEach(b=>b.addEventListener("click",()=>{creatorPosition=b.dataset.pos;renderCreator()}));
 const chip=$("positionChip");if(chip)chip.textContent=pos.chip;
 const head=$("creatorHeadline");if(head)head.textContent=`14岁 · ${pos.name} · CQG 青训队`;}
$("originPicker").innerHTML=Object.entries(ORIGIN_TIERS).map(([k,t])=>`<button class="origin-card ${creatorOrigin===k?"active":""}" type="button" data-origin="${k}"><b>${esc(t.name)}</b><span>${esc(t.tag)}</span><p>${esc(t.desc)}<br>${Object.entries(t.adj).map(([a,v])=>`${ATTRS.find(x=>x.key===a).name}${v>0?"+":""}${v}`).join(" ")||"七项都不加不减"}</p></button>`).join("");$("originPicker").querySelectorAll("[data-origin]").forEach(b=>b.addEventListener("click",()=>{creatorOrigin=b.dataset.origin;renderCreator()}));$("attributeAllocator").innerHTML=ATTRS.map(x=>`<div class="allocate-row"><div class="allocate-name"><b>${x.icon} ${x.key} ${x.name}</b><span>${x.sub}</span></div><div class="allocate-track"><i style="width:${creatorAllocation[x.key]*5}%"></i></div><button class="step-btn" data-stat="${x.key}" data-delta="-1" ${creatorAllocation[x.key]<=0?"disabled":""}>−</button><button class="step-btn" data-stat="${x.key}" data-delta="1" ${left<=0?"disabled":""}>＋</button><div class="allocate-value">${creatorAllocation[x.key]}</div></div>`).join("");$("talentDraft").innerHTML=creatorTalents.map(id=>{const t=talentById(id);return`<article class="talent-card"><span class="sigil">${t.icon}</span><b>${esc(t.name)}</b><p>${esc(t.desc)}</p></article>`}).join("");const dp=$("difficultyPicker");if(dp){dp.innerHTML=Object.values(DIFFICULTIES).map(d=>`<button class="diff-card ${creatorDifficulty===d.key?"active":""}" data-diff="${d.key}"><b>${esc(d.name)}</b><span class="diff-tag">${esc(d.tag)}</span><p>${esc(d.desc)}</p></button>`).join("");dp.querySelectorAll("[data-diff]").forEach(b=>b.addEventListener("click",()=>{creatorDifficulty=b.dataset.diff;renderCreator()}))}
$("rerollTalents").disabled=rerollsLeft<=0;$("startGame").disabled=left!==0||creatorTalents.length!==3||!$("playerName").value.trim();$("attributeAllocator").querySelectorAll("[data-stat]").forEach(b=>b.addEventListener("click",()=>{const k=b.dataset.stat,d=Number(b.dataset.delta),remaining=ALLOC_BUDGET-Object.values(creatorAllocation).reduce((a,v)=>a+v,0);if(d>0&&remaining<=0||d<0&&creatorAllocation[k]<=0)return;creatorAllocation[k]+=d;renderCreator()}))}

function renderPrologue(){const p=PROLOGUE[prologueIndex];$("prologuePortrait").src=p.portrait;$("prologueKicker").textContent=p.kicker;$("prologueTitle").textContent=p.title;$("prologueBody").innerHTML=p.body.map(x=>`<p>${x}</p>`).join("");$("prologueProgress").style.width=`${(prologueIndex+1)/PROLOGUE.length*100}%`;$("nextPrologue").innerHTML=prologueIndex===PROLOGUE.length-1?"进入青训队 <span>→</span>":"继续 <span>→</span>"}
function showGame(){$("menu")?.classList.add("hidden");$("creator").classList.add("hidden");$("prologue").classList.add("hidden");$("ending")?.classList.add("hidden");$("game").classList.remove("hidden");if(S.retired){showEnding(S);return}updateRanking(S);saveGame();renderAll();if(S.pendingMatch)setTimeout(()=>resumeMatchFlow(S),60)}
function showEnding(s){const e=buildEnding(s),el=$("ending");if(typeof document==="undefined"||!el)return;$("game").classList.add("hidden");$("modalMask").classList.add("hidden");el.classList.remove("hidden");
  $("endingBody").innerHTML=`<span class="eyebrow">CAREER OVER · ${esc(e.difficulty)}难度</span><h2>${esc(s.name)} · ${e.age}岁挂靴</h2><div class="ending-grade">${esc(e.grade)}</div><p class="ending-line">${e.line}</p>
  <div class="metric-grid">${e.metrics.map(x=>`<div class="metric"><b>${esc(x[0])}</b><span>${esc(x[1])}</span></div>`).join("")}</div>
  <p class="ending-line">生涯最高能力 <b>${e.peak}</b> · 最终生涯积分 <b>${e.score}</b></p>
  <p class="ending-line">${e.loveEnd}</p>${e.coda?`<p class="ending-line">${e.coda}</p>`:""}
  ${e.honours.length?`<div class="section-head"><h2>奖杯陈列</h2><span>${e.honours.length}件</span></div><div class="trophy-shelf">${e.honours.map(h=>`<article class="honour-card"><div class="trophy-icon">${esc(h.icon||"♛")}</div><b>${esc(h.title)}</b><span>第${h.season}赛季 · ${esc(h.detail||"")}</span></article>`).join("")}</div>`:`<p class="ending-line">奖杯架空着，但父亲那把旧键盘，一直摆在你家最显眼的位置。</p>`}
  <button id="endingRestart" class="primary-cta" type="button">开启新的生涯 <span>→</span></button>`;
  $("endingRestart").addEventListener("click",()=>{try{localStorage.removeItem(SAVE_KEY)}catch(e){}S=null;modalQueue=[];modalBusy=false;$("continueBtn")?.remove();creatorAllocation={...START_ALLOC};creatorOrigin="normal";creatorPosition="mid";creatorTalents=randomTalents();rerollsLeft=1;el.classList.add("hidden");$("creator").classList.remove("hidden");renderCreator()})}
function startNewGame(){const name=$("playerName").value.trim();$("continueBtn")?.remove();modalBusy=false;modalQueue=[];S=createInitialState(name,creatorAllocation,creatorTalents,creatorDifficulty,creatorOrigin,creatorPosition);META.runs=(META.runs||0)+1;saveMeta();saveGame();prologueIndex=0;$("creator").classList.add("hidden");$("prologue").classList.remove("hidden");renderPrologue()}
function requestRestart(){if(!S){location.reload();return}enqueueDecision({title:"重新开始这段生涯？",body:`当前${ageInfo(S).age}岁的进度会被新存档覆盖。本地成就与历史排行会保留。`,options:[option("保留当前进度","返回游戏",()=>{}),option("确认重开","清除当前存档，回到创建选手",()=>{try{localStorage.removeItem(SAVE_KEY)}catch(e){}S=null;modalQueue=[];modalBusy=false;$("continueBtn")?.remove();creatorAllocation={...START_ALLOC};creatorOrigin="normal";creatorPosition="mid";creatorTalents=randomTalents();rerollsLeft=1;$("game").classList.add("hidden");$("creator").classList.remove("hidden");renderCreator()},"danger")]},"重新开档")}

function init(){
  creatorTalents=randomTalents();renderCreator();
  const saved=loadGame();
  if(saved){$("menuContinue").classList.remove("hidden");$("menuContinue").innerHTML=`继续 · ${esc(saved.name)} · ${ageInfo(saved).age}岁 <span>→</span>`;$("menuContinue").addEventListener("click",()=>{if(!loadGame())return;S=saved;$("menu").classList.add("hidden");showGame();resumeCup(S)})}else{$("menuNew").className="primary-cta"}
  $("menuNew").addEventListener("click",()=>{$("menu").classList.add("hidden");$("creator").classList.remove("hidden");renderCreator()});
  ["gesturestart","gesturechange","gestureend"].forEach(ev=>document.addEventListener(ev,e=>e.preventDefault(),{passive:false}));
  $("playerName").addEventListener("input",renderCreator);$("rerollTalents").addEventListener("click",()=>{if(rerollsLeft<=0)return;creatorTalents=randomTalents();rerollsLeft--;renderCreator()});$("startGame").addEventListener("click",startNewGame);$("nextPrologue").addEventListener("click",()=>{const now=Date.now();if(now-prologueClickAt<300)return;prologueClickAt=now;if(prologueIndex<PROLOGUE.length-1){prologueIndex++;renderPrologue()}else showGame()});
  document.addEventListener("keydown",trapModalFocus);
  $("gameNav").addEventListener("click",e=>{const b=e.target.closest("button[data-tab]");if(!b||!S)return;S.tab=b.dataset.tab;saveGame();renderAll()});$("endMonthBtn").addEventListener("click",()=>advanceMonth());$("saveBtn").addEventListener("click",()=>toast(saveGame()?"进度已保存在本机":"保存失败"));$("restartBtn").addEventListener("click",requestRestart);
}

const API={VERSION,asset,momentHeadline,TALENTS,ATTRS,ATTR_KEYS,POSITIONS,posOf,posName,attrW,regionOf,TEAM_REGION,REGION_FLAGS,PLAYOFF_POOL,CAMPUS_TEAMS,INTL_OPPONENTS,matchMonthsOfSeason,playableFixture,START_ALLOC,ALLOC_BUDGET,ORIGIN_TIERS,gain,softFactor,ACTIONS,COMBOS,STYLES,MOMENTS,MATCH_PLANS,MATCH_ACTION_LINES,CHALLENGE_TIERS,EVENTS,ACHIEVEMENTS,LPL_TEAMS,LCK_TEAMS,DIFFICULTIES,createInitialState,overall,cond,eff,effOverall,atk,def,COND_SENS,loveSupport,familySupport,ageInfo,phaseOf,chooseRandomEvent,simulateMatchCore,applyMatch,routeChoice16,setRoute,enterProAt18,generateOffers,acceptOffer,nationalSelectionCheck,simulateNationalMatch,scheduleQualifiers,settleQualifiers,nationalStrength,fixtureClub,startCupFinals,cupMatchSim,cupDraw,seasonAwardCheck,toSeries,careerScore,applyAging,shouldRetire,buildEnding,makeSeasonGoal,evaluateSeasonGoal,breakupCheck,normalizeSave,migrateV2toV3,radarSVG,prepareMatch,startChance,ensureSchedule,buildSchedule,ensureLeague,buildLeague,leagueStandings,advanceLeagueRound,leagueRng,simLeagueMatch,opponentPool,clubRoundOf,leagueTableHTML,leagueChampion,inRelegationZone,seasonFinalLeague,ensureRival,rivalActive,rivalRng,rivalBaseLevel,rivalCardHTML,rivalEveLine,rivalSeasonSettle,strengthStars,starRating,teamStrengthBlock,fixtureOfMonth,nextFixture,fixtureCountdown,fixtureRow,shouldPlayMatch,resumeCup,PENALTY_OPTIONS,penaltyKickerRound,penaltyRate,teamPenaltyRate,cupFinalEve,cupOutroScene,cupFinish,newShootout,shootoutAdvance,shootoutPlayerKick,resolveMoments,finishMatch,styleLevel,styleCapLevel,styleOf,addStyleExp,topStyle,momentSuccessRate,momentOptions,pickMoments,challengeProgress,challengeMet,challengeProgressText,newChallengeAcc,checkCombos,ASSETS,buyAsset,assetPassive,assetValue,assetLocked,trainMult,MSI_POOL,MSI_GROUP_POOL,MSI_ELITE_POOL,WORLDS_GROUP_POOL,WORLDS_ELITE_POOL,CUP_CONFIG,cupCfg,cupMonthOf,qualifierMonths,qualifierRoundAt,qualifierOpponent,advanceMonth:()=>advanceMonth(true),getState:()=>S,setState:s=>{S=s},
  /* 测试接缝：无 document 时 pumpModal 直接返回，弹窗只进队列不消费，
     于是测试可以自己把队列跑完。必须是取值函数——modalQueue 有 5 处整体
     重新赋值，导出数组引用会拿到悬空的旧数组。 */
  getModalQueue:()=>modalQueue,clearModalQueue:()=>{modalQueue=[];modalBusy=false},resumeMatchFlow,countryFlag,flagBadge,cupFixtureBoard,cupOpeningCopy,trophyPortrait};
if(typeof window!=="undefined")window.PlayerLife=API;
if(typeof globalThis!=="undefined")globalThis.PlayerLife=API;
if(typeof document!=="undefined")document.addEventListener("DOMContentLoaded",init);
