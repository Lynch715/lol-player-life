/* 模拟英雄联盟选手 · 结构与不变量测试
   跑法：node tests/structure.test.mjs
   这套测试只守「改坏了会当场毁掉一局游戏」的东西：
   分路权重、赛事日历、赛程合法性、比分合法性、赛区旗帜、存档迁移，
   以及一整段跑到退役的生涯不抛异常。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const code=fs.readFileSync(path.join(root,"app.js"),"utf8");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const css=fs.readFileSync(path.join(root,"style.css"),"utf8");

const store={};
const sandbox={console,Date,Math,JSON,setTimeout,clearTimeout,
  localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}}};
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(code,sandbox);
const G=sandbox.PlayerLife;

let passed=0,failed=0;
function ok(name,fn){try{fn();passed++}catch(e){failed++;console.error(`✗ ${name}\n    ${e.message.split("\n")[0]}`)}}

/* ========== 1. 引擎导出 ========== */
ok("引擎导出到 PlayerLife",()=>{
  assert.ok(G,"PlayerLife 应该被导出");
  ["createInitialState","overall","POSITIONS","ATTRS","toSeries","buildSchedule","cupMonthOf"]
    .forEach(k=>assert.ok(G[k],`API 缺少 ${k}`));
});

/* ========== 2. 七维属性与五分路 ========== */
ok("七维属性键与新术语一致",()=>{
  assert.equal(G.ATTR_KEYS.join(","),"REA,MEC,COM,LAN,AWA,END,MEN");
  G.ATTRS.forEach(a=>assert.ok(a.name&&a.sub&&a.icon,`${a.key} 缺少展示字段`));
});

ok("每条分路的权重之和是 1",()=>{
  assert.equal(G.POSITIONS.length,5,"必须正好五条分路");
  G.POSITIONS.forEach(p=>{
    const sum=G.ATTR_KEYS.reduce((t,k)=>t+(p.w[k]??0),0);
    assert.ok(Math.abs(sum-1)<1e-9,`${p.name} 权重和 ${sum} 不是 1`);
    G.ATTR_KEYS.forEach(k=>assert.ok(typeof p.w[k]==="number",`${p.name} 缺少 ${k} 权重`));
    assert.ok(p.chip&&p.sub&&p.desc,`${p.name} 缺少展示字段`);
  });
});

ok("同一套属性在不同分路上评分不同",()=>{
  const alloc={REA:0,MEC:24,COM:0,LAN:0,AWA:0,END:0,MEN:0};      // 全部堆操作
  const mid=G.createInitialState("测试",alloc,[],"standard","normal","mid");
  const sup=G.createInitialState("测试",alloc,[],"standard","normal","sup");
  assert.ok(G.overall(mid)>G.overall(sup),"操作型 build 在中单应当高于辅助");
});

ok("未知分路回落到中单",()=>{
  const s=G.createInitialState("测试",G.START_ALLOC,[],"standard","normal","不存在的路");
  assert.equal(s.position,"mid");
  assert.equal(G.posOf(s).key,"mid");
});

/* ========== 3. 出身档位 ========== */
ok("出身三档互为镜像且不占分配点",()=>{
  const mk=t=>G.createInitialState("测试",G.START_ALLOC,[],"standard",t,"mid");
  const wild=mk("wild"),normal=mk("normal"),academy=mk("academy");
  assert.equal(wild.attrs.REA-normal.attrs.REA,3);
  assert.equal(academy.attrs.REA-normal.attrs.REA,-3);
  assert.equal(wild.attrs.END-normal.attrs.END,-5);
  assert.equal(academy.attrs.END-normal.attrs.END,5);
  assert.equal(mk("不存在").originTier,"normal","未知档位必须回落");
});

/* ========== 4. 赛事日历 ========== */
ok("MSI 每年第6月，S 赛每年第11月，18岁前都不排",()=>{
  for(let m=0;m<48;m++)assert.equal(G.cupMonthOf(m),null,`第${m}月不该有国际赛事`);
  for(let m=48;m<200;m++){
    const cup=G.cupMonthOf(m),r=m%12;
    if(r===5)assert.equal(cup,"msi",`第${m}月应为 MSI`);
    else if(r===10)assert.equal(cup,"world",`第${m}月应为 S 赛`);
    else assert.equal(cup,null,`第${m}月不该有国际赛事`);
  }
});

ok("季后赛两轮落在 S 赛前的第8、9月",()=>{
  const worlds=58;                                   // 第5赛季（19岁）的 S 赛月
  const ms=G.qualifierMonths(worlds);
  assert.equal(ms.length,2,"季后赛只有两轮");
  assert.equal(ms.join(","),[worlds-3,worlds-2].join(","));
  ms.forEach((m,i)=>{
    const q=G.qualifierRoundAt(m);
    assert.ok(q,`第${m}月应属于季后赛`);
    assert.equal(q.wcMonth,worlds);
    assert.equal(q.round,i+1);
  });
  assert.equal(G.qualifierRoundAt(worlds),null,"S 赛当月不是季后赛轮次");
});

ok("同一届季后赛的两个对手确定且不重复",()=>{
  const a1=G.qualifierOpponent(58,1),a2=G.qualifierOpponent(58,2);
  assert.notEqual(a1.name,a2.name,"两轮不该撞同一个对手");
  assert.equal(G.qualifierOpponent(58,1).name,a1.name,"同一届重建必须给出同一个对手");
  assert.ok(G.PLAYOFF_POOL.some(t=>t.name===a1.name),"对手必须来自季后赛对手池");
});

/* ========== 5. 赛程合法性 ========== */
function proState(){
  const s=G.createInitialState("测试",G.START_ALLOC,[],"standard","normal","mid");
  s.totalMonth=60;                                   // 19岁，赛季初
  s.route="pro";s.flags.route16=true;s.flags.pro18=true;
  s.club={name:"BLG",league:"LPL",strength:92};
  s.national.called=true;
  return s;
}
ok("职业期赛程：第12月是休赛期，没有比赛",()=>{
  const sc=G.buildSchedule(proState(),()=>0.5);
  sc.fixtures.filter(G.playableFixture)
    .forEach(f=>assert.notEqual(f.month%12,11,`第12月不该排比赛（第${f.month}月）`));
  assert.ok(sc.fixtures.some(f=>f.type==="award"&&f.month%12===11),"第12月必须有转会期标记");
});

ok("没拿到门票就不排 S 赛，拿到了才排",()=>{
  const s=proState();
  const worlds=Math.floor(s.totalMonth/12)*12+10;
  const before=G.buildSchedule(s,()=>0.5).fixtures.find(f=>f.month===worlds);
  assert.notEqual(before&&before.type,"cup","没出线时第11月应照常打联赛");
  s.national.qualifiedFor=worlds;
  const after=G.buildSchedule(s,()=>0.5).fixtures.find(f=>f.month===worlds);
  assert.equal(after.type,"cup");
  assert.equal(after.cup,"world");
});

ok("MSI 不需要资格赛，直接排",()=>{
  const msi=G.buildSchedule(proState(),()=>0.5).fixtures.find(f=>f.month%12===5);
  assert.equal(msi.type,"cup");
  assert.equal(msi.cup,"msi");
});

ok("每一场可打的比赛都有对手和赛事名",()=>{
  const s=proState();
  s.national.qualifiedFor=Math.floor(s.totalMonth/12)*12+10;
  G.buildSchedule(s,Math.random).fixtures.filter(G.playableFixture).forEach(f=>{
    assert.ok(f.opponent,`第${f.month}月的对手为空`);
    assert.ok(f.competition,`第${f.month}月的赛事名为空`);
  });
});

/* ========== 6. 比分：电竞没有平局 ========== */
ok("toSeries 永远给出合法且分胜负的局分",()=>{
  const rng=()=>0.4;
  for(let a=0;a<=6;a++)for(let b=0;b<=6;b++)for(const bo of [3,5]){
    const {gf,ga}=G.toSeries(a,b,rng,bo),need=Math.ceil((bo+1)/2);
    assert.notEqual(gf,ga,`${a}-${b} (BO${bo}) 出现了平局`);
    assert.equal(Math.max(gf,ga),need,`${a}-${b} (BO${bo}) 胜方局分应为 ${need}`);
    assert.ok(Math.min(gf,ga)<need&&Math.min(gf,ga)>=0,`${a}-${b} (BO${bo}) 败方局分非法`);
  }
});

ok("联赛模拟不会产生平局，比分不超出 BO3",()=>{
  const rng=G.leagueRng(3,7);
  for(let i=0;i<300;i++){
    const r=G.simLeagueMatch(85,80,rng);
    assert.notEqual(r.gf,r.ga,"联赛出现平局");
    assert.ok(r.gf<=2&&r.ga<=2,`联赛比分 ${r.gf}-${r.ga} 超出 BO3 范围`);
  }
});

/* ========== 7. 赛区与旗帜 ========== */
ok("所有会出现在弹窗里的战队都有赛区旗帜",()=>{
  const names=new Set([G.LPL_TEAMS,G.LCK_TEAMS,G.MSI_POOL,G.WORLDS_GROUP_POOL,
    G.WORLDS_ELITE_POOL,G.INTL_OPPONENTS,G.PLAYOFF_POOL].flat().map(t=>t.name));
  const missing=[...names].filter(n=>G.countryFlag(n)==="🏳️");
  assert.equal(missing.join("、"),"",`这些战队查不到赛区旗帜：${missing.join("、")}`);
});

ok("战队名与赛区名都能查到旗帜",()=>{
  assert.equal(G.countryFlag("T1"),"🇰🇷");
  assert.equal(G.countryFlag("BLG"),"🇨🇳");
  assert.equal(G.countryFlag("LPL"),"🇨🇳");
  assert.equal(G.countryFlag("查无此队"),"🏳️","未知战队回落到中立旗");
});

ok("赛事画面带得上旗帜与奖杯",()=>{
  const copy=G.cupOpeningCopy("world",{group:[{name:"Fnatic"}],ko:[{name:"T1"}]},"BLG");
  assert.match(copy,/🇨🇳/,"己方赛区旗帜缺失");
  assert.match(copy,/🇰🇷|🇪🇺/,"对手赛区旗帜缺失");
  assert.match(G.trophyPortrait("world"),/召唤师奖杯/);
  assert.match(G.trophyPortrait("msi"),/MSI/);
});

/* ========== 8. 战队与对手池 ========== */
ok("战队池非空、无重名、强度在合理区间",()=>{
  assert.ok(G.LPL_TEAMS.length>=16,"LPL 至少 16 队");
  assert.ok(G.LCK_TEAMS.length>=10,"LCK 至少 10 队");
  [...G.LPL_TEAMS,...G.LCK_TEAMS,...G.CAMPUS_TEAMS].forEach(t=>{
    assert.ok(t.strength>=45&&t.strength<=95,`${t.name} 强度 ${t.strength} 越界`);
    assert.ok(t.league,`${t.name} 缺少联赛归属`);
  });
  assert.equal(new Set(G.LPL_TEAMS.map(t=>t.name)).size,G.LPL_TEAMS.length,"LPL 有重名战队");
});

ok("对手池永远不包含自己",()=>{
  const s=proState();
  [["LPL","BLG"],["LCK","T1"],["LDL","BLG.D"],["高校联赛","重庆大学电竞社"]].forEach(([lg,name])=>{
    s.club={name,league:lg,strength:88};
    const pool=G.opponentPool(s);
    assert.ok(pool.length>0,`${lg} 的对手池为空`);
    assert.ok(!pool.some(o=>o.name===s.club.name),`${lg} 的对手池包含了自己`);
  });
});

/* ========== 9. 行动、流派、天赋、关键时刻 ========== */
ok("训练行动的流派键都存在",()=>{
  const keys=new Set(G.STYLES.map(x=>x.key));
  assert.equal([...keys].sort().join(","),"call,carry,lane,macro");
  G.ACTIONS.filter(a=>a.style).forEach(a=>assert.ok(keys.has(a.style),`${a.name} 的流派 ${a.style} 不存在`));
});

ok("流派的主属性都是合法属性键",()=>{
  G.STYLES.forEach(st=>{
    assert.equal(st.levels.length,3,`${st.name} 必须有三级说明`);
    st.attrs.forEach(k=>assert.ok(G.ATTR_KEYS.includes(k),`${st.name} 的属性 ${k} 不存在`));
  });
});

ok("天赋 20 个且 id 不重复",()=>{
  assert.equal(G.TALENTS.length,20);
  assert.equal(new Set(G.TALENTS.map(t=>t.id)).size,20,"天赋 id 有重复");
  G.TALENTS.forEach(t=>assert.ok(t.name&&t.desc&&t.icon,`天赋 ${t.id} 缺少展示字段`));
});

ok("关键时刻的属性、流派与选项都合法",()=>{
  const styles=new Set(G.STYLES.map(x=>x.key));
  G.MOMENTS.forEach(m=>{
    assert.ok(m.body&&m.title,`关键时刻 ${m.id} 缺少文案`);
    assert.ok(m.options.length>=2,`关键时刻 ${m.id} 选项少于 2 个`);
    m.options.forEach(o=>{
      assert.ok(G.ATTR_KEYS.includes(o.stat),`${m.id}/${o.text} 的属性 ${o.stat} 不存在`);
      if(o.style)assert.ok(styles.has(o.style),`${m.id}/${o.text} 的流派 ${o.style} 不存在`);
      if(o.need)assert.ok(styles.has(o.need),`${m.id}/${o.text} 的解锁流派 ${o.need} 不存在`);
      assert.ok(typeof o.up==="number"&&typeof o.down==="number",`${m.id}/${o.text} 缺少评分增减`);
    });
  });
});

ok("关键时刻成功率永远锁在 15%—85%",()=>{
  const s=proState();
  [10,40,99].forEach(v=>{
    G.ATTR_KEYS.forEach(k=>s.attrs[k]=v);
    G.MOMENTS.forEach(m=>m.options.forEach(o=>[40,95].forEach(opp=>{
      const p=G.momentSuccessRate(s,m,o,opp,false);
      assert.ok(p>=.15-1e-9&&p<=.85+1e-9,`${m.id}/${o.text} 成功率 ${p} 越界`);
    })));
  });
});

/* ========== 10. 存档迁移 ========== */
ok("老存档缺分路/出身时能补齐",()=>{
  const s=G.createInitialState("测试",G.START_ALLOC,[],"standard","wild","adc");
  const raw=JSON.parse(JSON.stringify(s));
  delete raw.position;delete raw.originTier;
  const fixed=G.normalizeSave(raw);
  assert.ok(fixed,"迁移不应作废这份存档");
  assert.equal(fixed.position,"mid","缺分路时回落到中单");
  assert.equal(fixed.originTier,"normal","缺出身时回落到普通家庭");
  assert.ok(G.overall(fixed)>0);
});

/* ========== 11. 文案与难度 ========== */
/* 这份黑名单是踩过坑攒出来的：第一轮改造只做了关键词替换，结果
   「重庆铜梁龙」（真实中超队）当了整整一局的主队、资产页卖着营养师和跑步机、
   队长还在传袖标——全是关键词扫不出来的语义残留。分三类守：
   词汇（足球词）、实体（真实足球队名）、语义（只有球类才有的动作与器物）。 */
const BANNED = {
  "足球词汇":["足球","绿茵","球员","俱乐部","进球","射门","盘带","门将","球衣","点球大战","越位","角球",
             "任意球","头球","传中","直塞","单刀","解围","铲球","罚进","罚丢","球门","门前","球场","看台"],
  "真实足球队":["重庆铜梁龙","辽宁铁人","上海海港","上海申花","山东泰山","北京国安","成都蓉城",
             "Manchester United","Hull City","Arsenal","Liverpool","Chelsea","Everton","Fulham"],
  "足球赛事":["世界杯","亚洲杯","世预赛","中超","英超","欧冠","足协"],
  "只有球类才有的东西":["梯队","中圈","袖标","边翼卫","过人","跑位","合练","租借","草坪","冰浴",
             "力量器械","跑步机","营养师团队","运动科学中心","体能教练","热身赛","出场时间","U15","U16","U18"]
};
ok("代码与页面里没有残留的足球内容",()=>{
  const files=[["app.js",code],["index.html",html],["style.css",css]];
  const found=[];
  for(const [cat,words] of Object.entries(BANNED))
    for(const w of words)
      for(const [f,text] of files){
        /* 「键盘带上」会撞出假的「盘带」，这类跨词边界的误报要放行。 */
        const safe={"盘带":["键盘带"],"过人":["超过人"],"球场":[],"梯队":[]};
        let t=text;(safe[w]||[]).forEach(x=>{t=t.split(x).join("")});
        if(t.includes(w))found.push(`${f} 里还留着[${cat}]「${w}」`);
      }
  assert.equal(found.length,0,found.join(" ｜ "));
});

ok("玩家的出身战队不是真实足球队",()=>{
  const s=G.createInitialState("测试",G.START_ALLOC,[],"standard","normal","mid");
  assert.match(s.club.name,/CQG/,"起始青训队应属于虚构的重庆战队 CQG");
  assert.equal(s.club.league,"LDL","青训期应在二级联赛 LDL");
  assert.ok(G.LPL_TEAMS.some(t=>t.name==="CQG"),"CQG 必须在 LPL 名单里，否则联赛榜上没有你自己");
  assert.equal(G.countryFlag("CQG"),"🇨🇳","CQG 要能查到赛区旗帜");
});

ok("资产页十九件商品都已电竞化",()=>{
  assert.equal(G.ASSETS.length,19);
  const sportish=["跑步机","力量器械","营养师团队","运动科学","冰浴","名宿","大巴","泳池","青训学校"];
  G.ASSETS.forEach(a=>{
    assert.ok(a.name&&a.desc&&a.effect,`资产 ${a.id} 缺少展示字段`);
    sportish.forEach(w=>assert.ok(!(a.name+a.desc).includes(w),`资产「${a.name}」里还留着「${w}」`));
  });
});

ok("难度三档的年龄轴符合电竞生涯长度",()=>{
  Object.values(G.DIFFICULTIES).forEach(d=>{
    assert.ok(d.decayAge>=22&&d.decayAge<=25,`${d.name} 衰退年龄 ${d.decayAge} 不像电竞`);
    assert.ok(d.retireAge>=26&&d.retireAge<=29,`${d.name} 退役年龄 ${d.retireAge} 不像电竞`);
    assert.ok(d.retireAge>d.decayAge+2,`${d.name} 衰退到退役之间太短`);
  });
});

/* ========== 12. 端到端 ========== */
ok("五条分路各跑一段生涯到退役都不报错",()=>{
  for(const pos of ["top","jug","mid","adc","sup"]){
    const s=G.createInitialState("测试",G.START_ALLOC,["big_heart","insane_hands","game_iq"],"standard","wild",pos);
    s.route="pro";s.flags.route16=true;s.flags.pro18=true;
    s.club={name:"LNG",league:"LPL",strength:88};
    s.national.called=true;s.totalMonth=48;
    const d=G.DIFFICULTIES[s.difficulty];
    while(G.ageInfo(s).age<=d.retireAge&&s.totalMonth<400){
      G.ensureSchedule(s);G.ensureLeague(s);
      const fx=G.fixtureOfMonth(s);
      if(fx&&fx.type!=="cup"){
        const rep=G.simulateMatchCore(s);
        G.applyMatch(s,rep);
        G.advanceLeagueRound(s,{opponent:fx.opponent,result:rep},G.clubRoundOf(s,fx.month)||1);
      }
      s.totalMonth++;
      if(s.totalMonth%12===0)G.applyAging(s);
    }
    assert.ok(G.shouldRetire(s),`${pos} 到 ${d.retireAge} 岁后应当能退役`);
    assert.ok(G.buildEnding(s),`${pos} 的结局生成失败`);
  }
});

ok("联赛积分榜排得出名次且没有平局",()=>{
  const s=proState();
  G.ensureSchedule(s);G.ensureLeague(s);
  for(let r=1;r<=6;r++)G.advanceLeagueRound(s,null,r);
  const table=G.leagueStandings(s.league);
  assert.ok(table.length>=16,"LPL 榜必须列出所有队");
  table.forEach(row=>assert.equal(row.d||0,0,`${row.name} 出现了平局场次`));
  for(let i=1;i<table.length;i++)
    assert.ok(table[i-1].pts>=table[i].pts,"积分榜没有按积分排序");
});

/* ========== 13. 图片路径：单文件版专属的裂图陷阱 ========== */
ok("app.js 里不许把图片路径直接写进 HTML 属性",()=>{
  /* 打包脚本按「带引号的 assets 路径」做替换，HTML 属性的引号会被一并命中，
     结果 src 里塞进一段 JS 表达式，单文件版就是一张裂图——而且开发版一切正常，
     只有打包后才暴露。故事页女主那张关系卡就这么裂过。 */
  const bad=[...code.matchAll(/(?:src|href)="assets\//g)];
  assert.equal(bad.length,0,`app.js 里有 ${bad.length} 处把路径写死在属性里，应改成 \${asset(...)}`);
  assert.ok(/function asset\(/.test(code),"asset() 解析口子不见了");
});

ok("每一处立绘引用都能在 assets 里找到文件",()=>{
  const refs=new Set([...code.matchAll(/assets\/([\w-]+\.webp)/g)].map(m=>m[1]));
  const have=new Set(fs.readdirSync(path.join(root,"assets")).filter(f=>f.endsWith(".webp")));
  const missing=[...refs].filter(f=>!have.has(f));
  const unused=[...have].filter(f=>!refs.has(f));
  assert.equal(missing.join(" "),"",`这些图被引用但文件不存在：${missing.join(" ")}`);
  assert.equal(unused.join(" "),"",`这些图没有任何地方引用：${unused.join(" ")}`);
});

console.log(failed?`\n${passed} 组通过，${failed} 组失败`:`\n✓ ${passed} 组断言全部通过`);
if(failed)process.exitCode=1;
