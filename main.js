// ========= 小工具 =========
const $ = id => document.getElementById(id);
const fmt = (n, d=2) => (isFinite(n) ? Number(n).toFixed(d) : '—');
const parseNum = id => { const v=$(id).value.trim(); return v===''?NaN:Number(v); };
const secPerKmToPace = s => !isFinite(s)||s<=0 ? '—' : `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
const paceToSecPerKm = s => { if(!s) return NaN; const a=s.split(':').map(Number); return a.length===2? a[0]*60+a[1] : NaN; };

function toSeconds(hms){
  if(!hms) return NaN;
  const t=hms.replace(/[^\d:]/g,'').split(':').map(s=>s.trim());
  if(t.length===3){ const [h,m,s]=t.map(Number); return h*3600+m*60+s; }
  if(t.length===2){ const [m,s]=t.map(Number); return m*60+s; }
  if(t.length===1){ return Number(t[0]); }
  return NaN;
}
function secondsToHMS(sec){
  if(!isFinite(sec)) return '—';
  const sign=sec<0?'-':'';
  sec=Math.abs(sec);
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=Math.round(sec%60);
  return `${sign}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function explainHoursFromSeconds(T){
  if(!isFinite(T)) return {hours:NaN,text:'T = —'};
  const h=Math.floor(T/3600), m=Math.floor((T%3600)/60), s=Math.round(T%60);
  return {hours:T/3600, text:`T = ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} = ${h} + ${m}/60 + ${s}/3600 = ${(T/3600).toFixed(3)} h`};
}

// ========= 模型 =========
const ep = (D,G) => (Number(D)||0) + (Number(G)||0)/100;
const eph = (EP,Tsec) => { const h=(Number(Tsec)||0)/3600; return h>0? EP/h : NaN; };
const epace = (EP,Tsec) => { const v=eph(EP,Tsec); return (!isFinite(v)||v<=0)?'—':secPerKmToPace((1/v)*3600); };

function ep_cal(D,G,Des,R){ const d = (!isFinite(R)||R<=0)?0:(Number(Des)||0)/R; return (Number(D)||0)+(Number(G)||0)/100+d; }
function target_eph_from_cutoff(D,G,Des,cutoff,R){
  const EP=ep_cal(D,G,Des,R), h=(Number(cutoff)||0)/3600;
  return h>0? EP/h : NaN;
}
function train_time_from_target_eph(d,g,des,targetEPH,R){
  const EPt=ep_cal(d,g,des,R);
  if(!isFinite(targetEPH)||targetEPH<=0) return NaN;
  return (EPt/targetEPH)*3600;
}

// Rloss 估算
function calibrate_r_loss(T_sec, Des_m, p_down_pct, Pflat_spk, Pdown_spk, g_down_pct){
  const T=Number(T_sec)||0, Des=Number(Des_m)||0, pDown=(Number(p_down_pct)||0)/100;
  const Pflat=Number(Pflat_spk)||NaN, Pdown=Number(Pdown_spk)||NaN, gDown=Number(g_down_pct)||NaN;
  if(T<=0||Des<=0||pDown<=0||!isFinite(Pflat)) return { rloss: NaN, method:'preset', delta_down: NaN };
  const Tdown=pDown*T;
  let d_down_km;
  if(isFinite(Pdown)) d_down_km=Tdown/Pdown;
  else{
    if(!isFinite(gDown)||gDown<=0) return { rloss: NaN, method:'preset', delta_down: NaN };
    d_down_km=(Des/(gDown/100))/1000;
  }
  const D_eq_down=Tdown/Pflat;
  const delta=Math.max(0, D_eq_down - d_down_km);
  if(delta<=0) return { rloss: Infinity, method: isFinite(Pdown)?'pace_based':'slope_based', delta_down:0 };
  let r=Des/delta; r=Math.min(800, Math.max(80, r));
  return { rloss:r, method: isFinite(Pdown)?'pace_based':'slope_based', delta_down:delta };
}

// ========= 歷史 =========
const KEY='eph_history_v1';
const loadHistory=()=>{ try{return JSON.parse(localStorage.getItem(KEY))||[]}catch{return []}};
const saveHistory=l=>localStorage.setItem(KEY,JSON.stringify(l));
function pushHistory(entry){ const L=loadHistory(); L.unshift(entry); if(L.length>20)L.pop(); saveHistory(L); renderHistory(); }
function renderHistory(){
  const L=loadHistory(), el=$('historyList');
  if(!el) return;
  if(!L.length){ el.innerHTML='尚無紀錄'; return; }
  el.innerHTML=`<table class="table"><thead><tr><th>時間</th><th>類型</th><th class="mono">摘要</th></tr></thead><tbody>${
    L.map(x=>`<tr><td>${new Date(x.ts).toLocaleString()}</td><td>${x.type}</td><td class="mono">${x.summary||''}</td></tr>`).join('')
  }</tbody></table>`;
}

// ========= 耐力衰退與風險 =========
function staminaFactor(r){ if(!isFinite(r)||r<=1) return 1; let f=Math.pow(0.93, Math.log2(r)); return Math.min(1, Math.max(0.70, f)); }
function colorByRatio(x,g,y){ if(!isFinite(x)||x<=0) return {cls:'risk-high', label:'資料不足'}; if(x>=g) return {cls:'risk-low', label:'良好'}; if(x>=y) return {cls:'risk-mid', label:'注意'}; return {cls:'risk-high', label:'偏低'}; }

function renderRisk(_EP_race, predT){
  const list=$('riskList'); if(!list) return {factor:1, level:'—'};
  const raceD=parseNum('raceD')||0, raceG=parseNum('raceG')||0;
  const maxD=parseNum('maxLongD'), maxG=parseNum('maxLongG'), maxT=toSeconds($('maxLongTime').value.trim());
  const wkD=parseNum('wkAvgD'), wkG=parseNum('wkAvgG');

  const r0=(isFinite(maxG)&&raceG>0)? maxG/raceG : NaN;
  const r1=(isFinite(maxD)&&raceD>0)? maxD/raceD : NaN;
  const r2=(isFinite(maxT)&&isFinite(predT)&&predT>0)? maxT/predT : NaN;
  const r3=(isFinite(wkD)&&raceD>0)? wkD/raceD : NaN;
  const r4=(isFinite(wkG)&&raceG>0)? wkG/raceG : NaN;

  const c0=colorByRatio(r0,0.60,0.40), c1=colorByRatio(r1,0.40,0.25), c2=colorByRatio(r2,0.70,0.50), c3=colorByRatio(r3,0.90,0.60), c4=colorByRatio(r4,1.00,0.60);

  const target_r0=0.60*raceG, target_r1=0.40*raceD, target_r2=0.70*(predT||0), target_r3=0.90*raceD, target_r4=1.00*raceG;
  const pct=x=>isFinite(x)?`${fmt(x*100,0)}%`:'—';
  const diffText=(type,cur,tgt)=>{
    if(!isFinite(tgt)) return '';
    const label= type==='time'? secondsToHMS(tgt) : (type==='gain'? `${Math.round(tgt)} m` : `${fmt(tgt,2)} km`);
    if(!isFinite(cur)) return `｜建議 ≥ ${label}`;
    if(cur>=tgt) return `｜目標 ≥ ${label} ✔`;
    const gap = type==='time'? secondsToHMS(tgt-cur) : (type==='gain'? `${Math.round(tgt-cur)} m` : `${fmt(tgt-cur,2)} km`);
    return `｜建議 ≥ ${label}（尚差 ${gap}）`;
  };

  list.innerHTML=[
    `● 單次最長爬升／比賽爬升：${pct(r0)}（${c0.label}）${diffText('gain',maxG,target_r0)}`,
    `● 單次最長距離／比賽距離：${pct(r1)}（${c1.label}）${diffText('km',maxD,target_r1)}`,
    `● 單次最長時間／預估完賽：${pct(r2)}（${c2.label}）${diffText('time',maxT,target_r2)}`,
    `● 近四週平均距離／比賽距離：${pct(r3)}（${c3.label}）${diffText('km',wkD,target_r3)}`,
    `● 近四週平均爬升／比賽爬升：${pct(r4)}（${c4.label}）${diffText('gain',wkG,target_r4)}`
  ].join('<br>');

  const mult=(c,t)=> c==='risk-low'?1 : c==='risk-mid'?(t==='r2'?0.95:0.97) : (t==='r2'?0.88:0.90);
  const f0=mult(c0.cls,'r0'), f1=mult(c1.cls,'r1'), f2=mult(c2.cls,'r2'), f3=mult(c3.cls,'r3'), f4=mult(c4.cls,'r4');
  const factor=f0*f1*f2*f3*f4;

  let level='中';
  const reds=[c0,c1,c2,c3,c4].filter(x=>x.cls==='risk-high').length;
  const yellows=[c0,c1,c2,c3,c4].filter(x=>x.cls==='risk-mid').length;
  if(reds>=2 || (reds===1 && yellows>=2)) level='高';
  else if(reds===0 && yellows<=2) level='低';

  return {factor, level};
}

// 反推：為守關門所需訓練 EPH
function requiredTrainingEPHForCutoff(EP_race, cutoffSec, T_ref, riskFactor, bufferPct){
  if(!isFinite(EP_race)||EP_race<=0||!isFinite(cutoffSec)||cutoffSec<=0||!isFinite(T_ref)||T_ref<=0||!isFinite(riskFactor)||riskFactor<=0) return NaN;
  const buf=1+(Number(bufferPct)||0)/100;
  const fT=(EPH)=>{ const F=staminaFactor((EP_race/EPH*3600)/T_ref); return (EP_race/(EPH*F*riskFactor))*3600*buf; };
  let lo=0.1, hi=100;
  for(let i=0;i<60;i++){ const mid=(lo+hi)/2, t=fT(mid); if(t>cutoffSec) lo=mid; else hi=mid; }
  return hi;
}

// ========= 全域狀態 =========
let LAST=null;
let PRED=null;
let SUMMARY_VIEW='novice'; // novice | cal

// ========= 計算「我的訓練」 =========
function compute(){
  const D=parseNum('dist'), G=parseNum('gain'), Des=parseNum('descent');
  const T=toSeconds($('time').value.trim());
  const rlossPreset=parseNum('rloss');
  const Pflat=paceToSecPerKm($('pflat').value.trim()), pDownPct=parseNum('pdown'), Pdown=paceToSecPerKm($('pdownpace').value.trim()), gDown=parseNum('gdown');

  // 一般
  const EPb=ep(D,G), EPHb=eph(EPb,T), EPaceb=epace(EPb,T);
  const tExplain=explainHoursFromSeconds(T);
  $('basicEP').textContent=fmt(EPb,2);
  $('basicEPH').textContent=fmt(EPHb,2);
  $('basicEPace').textContent=EPaceb;
  $('basicSteps').textContent=
`${tExplain.text}
EP = D + G/100 = ${fmt(D,2)} + ${fmt(G,0)}/100 = ${fmt(EPb,2)} ekm
EPH = EP / (T/3600) = ${fmt(EPb,2)} / (${fmt(T/3600,3)} h) = ${fmt(EPHb,2)} ekm/h
配速 = ${secondsToHMS(T)} ÷ ${fmt(EPb,2)} = ${EPaceb} 分/ekm`;

  // 進階
  let cal={rloss:rlossPreset,method:'preset'};
  if(isFinite(Pflat)&&isFinite(pDownPct)&&isFinite(Des)&&isFinite(T)&&T>0&&Des>0&&pDownPct>0){
    cal = calibrate_r_loss(T, Des, pDownPct, Pflat, Pdown, gDown);
  }
  $('advPreset').textContent = `（Rloss：${cal.method==='preset'?'preset':'自訂'}）`;

  const r_use=isFinite(cal.rloss)?cal.rloss:rlossPreset;
  const EPc=ep_cal(D,G,Des,r_use), EPHc=eph(EPc,T), EPacec=epace(EPc,T);
  $('calEP').textContent=fmt(EPc,2);
  $('calEPH').textContent=fmt(EPHc,2);
  $('calEPace').textContent=EPacec;
  $('calMeta').innerHTML=`R<sub>loss</sub>（使用中）＝<strong>${fmt(r_use,0)}</strong>（${cal.method==='preset'?'preset':'自訂'}）`;
  $('calSteps').textContent=
`${tExplain.text}
EP_cal = D + G/100 + Des/R_loss = ${fmt(D,2)} + ${fmt(G,0)}/100 + ${isFinite(Des)?fmt(Des,0):0}/${fmt(r_use,0)} = ${fmt(EPc,2)} ekm
EPH_cal = EP_cal / (T/3600) = ${fmt(EPc,2)} / (${fmt(T/3600,3)} h) = ${fmt(EPHc,2)} ekm/h
配速 = ${secondsToHMS(T)} ÷ ${fmt(EPc,2)} = ${EPacec} 分/ekm`;

  // 差異徽章 + 一句話
  const diff=(isFinite(EPHb)&&isFinite(EPHc))? ((EPHc-EPHb)/EPHb*100) : NaN;
  const badge=$('diffBadge');
  if(isFinite(diff)){
    badge.textContent = diff>0?`+${fmt(diff,1)}%` : diff<0?`${fmt(diff,1)}%` : '+0.0%';
    badge.className='badge '+(diff>0?'delta-pos':diff<0?'delta-neg':'delta-zero');
    $('diffLine').textContent = diff===0
      ? '兩版幾乎一致：賽道下降影響極小。'
      : `進階考慮下降成本 → EPH 估計${diff>0?'提升':'下降'} ${fmt(Math.abs(diff),1)}%（相較一般版）。`;
  }else{
    badge.textContent='+0.0%'; badge.className='badge delta-zero';
    $('diffLine').textContent='—';
  }

  $('copyBasicVals').dataset.copy = `一般 EP=${fmt(EPb,2)} ekm，EPH=${fmt(EPHb,2)} ekm/h，配速=${EPaceb}`;
  $('copyCalVals').dataset.copy   = `進階 EP=${fmt(EPc,2)} ekm，EPH=${fmt(EPHc,2)} ekm/h，配速=${EPacec}，Rloss=${fmt(r_use,0)}`;

  LAST={D,G,Des,EPH_basic:EPHb,EPH_cal:EPHc,T, r_use, mode:isFinite(EPHc)?'進階':'一般'};
  pushHistory({ts:Date.now(),type:'EPH 計算',summary:`D=${fmt(D,2)}km, G=${fmt(G,0)}m, Des=${isFinite(Des)?fmt(Des,0):'-'}m, T=${secondsToHMS(T)}, EPH=${fmt(EPHb,2)}/${fmt(EPHc,2)} (Rloss=${fmt(r_use,0)})`});

  predictFinish();
}

// ========= 賽事→訓練 =========
function plan(){
  const D=parseNum('raceD'), G=parseNum('raceG'), Des=parseNum('raceDes');
  const cutoff=toSeconds($('raceCutoff').value.trim());
  const d=parseNum('trainD'), g=parseNum('trainG'), des=parseNum('trainDes');
  const bufferPct=parseNum('bufferPct')||0;

  const rlossPreset=parseNum('rloss');
  const Pflat=paceToSecPerKm($('pflat').value.trim()), pDownPct=parseNum('pdown'), Pdown=paceToSecPerKm($('pdownpace').value.trim()), gDown=parseNum('gdown');

  // 進階 preset 標籤
  let cal={rloss:rlossPreset,method:'preset'};
  if(isFinite(Pflat)&&isFinite(pDownPct)&&isFinite(Des)&&isFinite(cutoff)&&cutoff>0&&Des>0&&pDownPct>0){
    cal = calibrate_r_loss(cutoff, Des, pDownPct, Pflat, Pdown, gDown);
  }
  $('planCalLabel').textContent = `使用中：${cal.method==='preset'?'preset':'自訂'}`;

  // 一般
  const EPH_race_basic=target_eph_from_cutoff(D,G,0,cutoff,Infinity);
  const t_train_basic=train_time_from_target_eph(d,g,0,EPH_race_basic,Infinity)*(1+bufferPct/100);
  $('raceBasicEPH').textContent=fmt(EPH_race_basic,2);
  $('trainBasicTime').textContent=secondsToHMS(t_train_basic);
  $('planBasicSteps').textContent=
`${explainHoursFromSeconds(cutoff).text}
EP_race = D + G/100 = ${fmt(D,2)} + ${fmt(G,0)}/100 = ${fmt(D+G/100,2)} ekm
EPH_race = ${fmt(D+G/100,2)} ÷ ${fmt(cutoff/3600,3)} = ${fmt(EPH_race_basic,2)} ekm/h
EP_train = d + g/100 = ${fmt(d,2)} + ${fmt(g,0)}/100 = ${fmt(d+g/100,2)} ekm
所需時間 = EP_train / EPH_race × 3600 = ${secondsToHMS(t_train_basic)}`;

  // 進階
  const r_use=isFinite(cal.rloss)?cal.rloss:rlossPreset;
  const EPH_race_cal=target_eph_from_cutoff(D,G,Des,cutoff,r_use);
  const t_train_cal=train_time_from_target_eph(d,g,des,EPH_race_cal,r_use)*(1+bufferPct/100);
  $('raceCalEPH').textContent=fmt(EPH_race_cal,2);
  $('trainCalTime').textContent=secondsToHMS(t_train_cal);
  $('planCalSteps').textContent=
`${explainHoursFromSeconds(cutoff).text}
EP_race_cal = D + G/100 + Des/R_loss = ${fmt(D,2)} + ${fmt(G,0)}/100 + ${isFinite(Des)?fmt(Des,0):0}/${fmt(r_use,0)}
EPH_race_cal = ${fmt(D + G/100 + (isFinite(Des)?Des/r_use:0),2)} ÷ ${fmt(cutoff/3600,3)} = ${fmt(EPH_race_cal,2)} ekm/h
EP_train_cal = d + g/100 + des/R_loss = ${fmt(d + g/100 + (isFinite(des)?des/r_use:0),2)} ekm
所需時間 = EP_train_cal / EPH_race_cal × 3600 = ${secondsToHMS(t_train_cal)}`;

  // 空狀態顯示
  const showEmpty = !(isFinite(EPH_race_basic)&&isFinite(t_train_basic)) && !(isFinite(EPH_race_cal)&&isFinite(t_train_cal));
  $('planEmpty').style.display = showEmpty ? 'block' : 'none';

  pushHistory({ts:Date.now(),type:'賽事→訓練',summary:`Race ${fmt(D,2)}km +${fmt(G,0)}m T=${secondsToHMS(cutoff)} → Train ${fmt(d,2)}km +${fmt(g,0)}m : ${secondsToHMS(t_train_basic)} / ${secondsToHMS(t_train_cal)} (Rloss=${fmt(r_use,0)})`});

  predictFinish();
}

// ========= 完賽預估 + 摘要列 =========
function predictFinish(){
  if(!LAST) return;
  const {EPH_basic:EPHb, EPH_cal:EPHc, r_use}=LAST;
  const D=parseNum('raceD'), G=parseNum('raceG'), Des=parseNum('raceDes');
  const cutoff=toSeconds($('raceCutoff').value.trim());
  const bufferPct=parseNum('bufferPct')||0;
  const T_ref=Math.max(2400, LAST.T||0); // 至少 40 分鐘

  // 一般
  const EP_race_basic=ep(D,G);
  let t_pred_basic = isFinite(EPHb)&&EPHb>0 ? (EP_race_basic/EPHb)*3600 : NaN;
  const Fb = isFinite(t_pred_basic)&&isFinite(T_ref)&&T_ref>0 ? staminaFactor(t_pred_basic/T_ref) : 1;
  const risk=renderRisk(EP_race_basic,t_pred_basic);
  const t_pred_basic_adj = isFinite(t_pred_basic)? (EP_race_basic/(EPHb*Fb*risk.factor))*3600*(1+bufferPct/100) : NaN;

  $('predBasicTime').textContent=secondsToHMS(t_pred_basic_adj);
  let basicVerd='—'; const needList=[];
  if(isFinite(t_pred_basic_adj)&&isFinite(cutoff)&&cutoff>0){
    const diff=cutoff-t_pred_basic_adj;
    if(diff>=0) basicVerd=`✅ 關門內｜餘裕 ${secondsToHMS(diff)}`;
    else{
      basicVerd=`⚠️ 估計超過關門 ${secondsToHMS(-diff)}`;
      const needEPH=requiredTrainingEPHForCutoff(EP_race_basic, cutoff, T_ref, risk.factor, bufferPct);
      const EP_train=ep(LAST.D,LAST.G);
      const needT=isFinite(needEPH)? (EP_train/needEPH)*3600 : NaN;
      if(isFinite(needEPH)) needList.push(`訓練 EPH ≥ ${fmt(needEPH,2)} ekm/h`);
      if(isFinite(needT))  needList.push(`此訓練需 ≤ ${secondsToHMS(needT)}`);
    }
  }
  $('predBasicNote').textContent=basicVerd;
  $('predBasicNeed').innerHTML = needList.map(x=>`<li>${x}</li>`).join('') || '';
  $('predBasicSlowest').textContent = isFinite(t_pred_basic_adj)? `以目前 EPH 可守的最慢關門：${secondsToHMS(t_pred_basic_adj)}` : '—';

  // 進階
  const EP_race_cal=ep_cal(D,G,Des,r_use);
  let t_pred_cal = isFinite(EPHc)&&EPHc>0 ? (EP_race_cal/EPHc)*3600 : NaN;
  const Fc = isFinite(t_pred_cal)&&isFinite(T_ref)&&T_ref>0 ? staminaFactor(t_pred_cal/T_ref) : 1;
  const t_pred_cal_adj = isFinite(t_pred_cal)? (EP_race_cal/(EPHc*Fc*risk.factor))*3600*(1+bufferPct/100) : NaN;

  $('predCalTime').textContent=secondsToHMS(t_pred_cal_adj);
  let calVerd='—'; const needList2=[];
  if(isFinite(t_pred_cal_adj)&&isFinite(cutoff)&&cutoff>0){
    const diff=cutoff-t_pred_cal_adj;
    if(diff>=0) calVerd=`✅ 關門內｜餘裕 ${secondsToHMS(diff)}`;
    else{
      calVerd=`⚠️ 估計超過關門 ${secondsToHMS(-diff)}`;
      const needEPH=requiredTrainingEPHForCutoff(EP_race_cal, cutoff, T_ref, risk.factor, bufferPct);
      const EP_train=ep_cal(LAST.D,LAST.G,LAST.Des,r_use);
      const needT=isFinite(needEPH)? (EP_train/needEPH)*3600 : NaN;
      if(isFinite(needEPH)) needList2.push(`訓練 EPH ≥ ${fmt(needEPH,2)} ekm/h`);
      if(isFinite(needT))  needList2.push(`此訓練需 ≤ ${secondsToHMS(needT)}`);
    }
  }
  $('predCalNote').textContent=calVerd;
  $('predCalNeed').innerHTML = needList2.map(x=>`<li>${x}</li>`).join('') || '';
  $('predCalSlowest').textContent = isFinite(t_pred_cal_adj)? `以目前 EPH 可守的最慢關門：${secondsToHMS(t_pred_cal_adj)}` : '—';

  // 摘要列
  PRED={
    eph: isFinite(LAST.EPH_cal)?LAST.EPH_cal:LAST.EPH_basic,
    mode: isFinite(LAST.EPH_cal)?'進階':'一般',
    basicTime: secondsToHMS(t_pred_basic_adj), basicVerd,
    calTime: secondsToHMS(t_pred_cal_adj), calVerd,
    riskLevel: risk.level
  };
  updateSummaryBar();
}

function updateSummaryBar(){
  const s=PRED, ls=LAST; if(!s||!ls) return;
  $('summaryEPH').textContent = isFinite(s.eph)? `${fmt(s.eph,2)} ekm/h` : '—';
  $('summaryMode').textContent = `（${ls.mode}）`;

  const time = SUMMARY_VIEW==='novice' ? s.basicTime : s.calTime;
  const verd = SUMMARY_VIEW==='novice' ? s.basicVerd : s.calVerd;
  $('summaryTime').textContent = time || '—';
  const v=$('summaryVerdict'); v.className='badge';
  if(verd.startsWith('✅')) v.classList.add('risk-low');
  else if(verd.startsWith('⚠️')) v.classList.add('risk-mid');
  v.textContent = verd || '—';

  const risk=$('summaryRisk'); risk.className='badge';
  risk.classList.add( s.riskLevel==='低'?'risk-low': s.riskLevel==='中'?'risk-mid':'risk-high' );
  risk.textContent=`訓練量風險：${s.riskLevel}`;
}

// ========= 分享圖 =========
async function makeSharePNG(){
  if(!LAST) compute();
  const s=LAST||{};
  const chosen = isFinite(s.EPH_cal)? s.EPH_cal : s.EPH_basic;
  const canvas=$('shareCanvas'); canvas.width=1000; canvas.height=420;
  const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,1000,420);

  const x=56, line=72;
  ctx.fillStyle='#fff'; ctx.shadowColor='rgba(0,0,0,.25)'; ctx.shadowBlur=6;
  ctx.font='700 50px system-ui,"Noto Sans","PingFang TC","Microsoft JhengHei",sans-serif'; ctx.fillText('Trail EPH', x, 68);
  ctx.shadowBlur=0; ctx.font='500 42px system-ui,"Noto Sans","PingFang TC","Microsoft JhengHei",sans-serif';
  const desTxt=(isFinite(s.Des)&&s.Des>0)?` | 下降 ${Math.round(s.Des)} m`:''; 
  ctx.fillText(`距離 ${fmt(s.D,2)} km`, x, 68+line);
  ctx.fillText(`爬升 +${Math.round(s.G||0)} m${desTxt}`, x, 68+line*2);
  ctx.fillText(`時間 ${secondsToHMS(s.T||0)}`, x, 68+line*3);
  ctx.font='800 84px system-ui,"Noto Sans","PingFang TC","Microsoft JhengHei",sans-serif';
  ctx.fillText(`EPH（進階） ${fmt(chosen,2)} ekm/h`, x, 420-48);

  const blob=await new Promise(res=>canvas.toBlob(res,'image/png'));
  const url=URL.createObjectURL(blob);
  const a=$('downloadLink'); a.href=url; a.download=`eph_${Date.now()}.png`; a.click();
}

// ========= 時間輸入（輸入中只插冒號；失焦才補零與驗證） =========
function digitsToHMS(digits) {
  const s = digits.padStart(6, '0'); // 6 位補零：hhmmss
  return `${s.slice(0,2)}:${s.slice(2,4)}:${s.slice(4,6)}`;
}
function maskTime(el) {
  const d = el.value.replace(/[^\d]/g, '').slice(0, 6);
  if (d.length === 0) { el.value = ''; return; }
  if (d.length <= 2) { el.value = d; return; }                                // hh
  if (d.length <= 4) { el.value = `${d.slice(0,2)}:${d.slice(2)}`; return; }  // hh:mm
  el.value = `${d.slice(0,2)}:${d.slice(2,4)}:${d.slice(4)}`;                 // hh:mm:ss
}
function validateTime(el, errId) {
  const d = el.value.replace(/[^\d]/g, '');
  const err = $(errId);
  if (d.length === 0) { err.textContent = ''; el.value = ''; return; }
  const hms = digitsToHMS(d);
  const s = toSeconds(hms);
  if (!isFinite(s)) { err.textContent = '格式需為 hh:mm:ss'; }
  else { err.textContent = ''; el.value = secondsToHMS(s); }
}

// ========= pDown / gDown 防呆 =========
function clampNumber(val, lo, hi){ if(!isFinite(val)) return NaN; return Math.min(hi, Math.max(lo, val)); }
function validatePDown(){ const el=$('pdown'); const v=Number(el.value); const err=$('pdownErr');
  if(el.value===''){ err.textContent=''; return; }
  if(v<0||v>100){ err.textContent='0–100 % 範圍內'; return; }
  if(v<10||v>60){ err.textContent='建議 10–60 %'; } else err.textContent='';
}
function blurPDown(){ const el=$('pdown'); if(el.value==='') return; const v=Number(el.value); if(!isFinite(v)) return; if(v<0||v>100) el.value=clampNumber(v,0,100); }
function validateGDown(){ const el=$('gdown'); const v=Number(el.value); const err=$('gdownErr');
  if(el.value===''){ err.textContent=''; return; }
  if(v<0||v>60){ err.textContent='0–60 % 範圍內'; return; }
  if(v<3||v>20){ err.textContent='建議 3–20 %'; } else err.textContent='';
}
function blurGDown(){ const el=$('gdown'); if(el.value==='') return; const v=Number(el.value); if(!isFinite(v)) return; if(v<0||v>60) el.value=clampNumber(v,0,60); }

// ========= 綁定 =========
document.addEventListener('DOMContentLoaded', ()=>{
  $('calcBtn').addEventListener('click', compute);
  $('resetBtn').addEventListener('click', ()=>{
    ['dist','gain','descent','time','pdown','pdownpace','gdown','rloss','pflat'].forEach(id=>$(id).value='');
    $('timeErr').textContent=''; $('pdownErr').textContent=''; $('gdownErr').textContent='';
    compute();
  });

  $('planBtn').addEventListener('click', ()=>{ plan(); predictFinish(); });
  $('planResetBtn').addEventListener('click', ()=>{
    ['raceD','raceG','raceDes','raceCutoff','trainD','trainG','trainDes','bufferPct'].forEach(id=>$(id).value='');
    $('raceCutoffErr').textContent=''; $('planEmpty').style.display='block';
    plan(); predictFinish();
  });

  $('clearHistoryBtn').addEventListener('click', ()=>{ localStorage.removeItem(KEY); renderHistory(); });
  $('shareBtn').addEventListener('click', makeSharePNG);
  $('summaryShare').addEventListener('click', makeSharePNG);
  $('summaryRecalc').addEventListener('click', ()=>{ compute(); plan(); predictFinish(); });

  // 複製
  const copy = async s=>{ try{ await navigator.clipboard.writeText(s);}catch{} };
  $('copyBasicSteps').addEventListener('click', ()=>copy($('basicSteps').innerText));
  $('copyCalSteps').addEventListener('click', ()=>copy($('calSteps').innerText));
  $('copyBasicVals').addEventListener('click', e=>copy(e.currentTarget.dataset.copy||''));
  $('copyCalVals').addEventListener('click', e=>copy(e.currentTarget.dataset.copy||''));

  // Segmented 切換（一般｜進階）＋鍵盤操作
  const setSeg=(view)=>{
    SUMMARY_VIEW=view;
    $('segNovice').classList.toggle('active', view==='novice');
    $('segCal').classList.toggle('active', view==='cal');
    $('segNovice').setAttribute('aria-checked', view==='novice'?'true':'false');
    $('segCal').setAttribute('aria-checked', view==='cal'?'true':'false');
    updateSummaryBar();
  };
  $('segNovice').addEventListener('click', ()=>setSeg('novice'));
  $('segCal').addEventListener('click', ()=>setSeg('cal'));
  document.querySelector('.seg').addEventListener('keydown', (e)=>{
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
      e.preventDefault();
      setSeg(SUMMARY_VIEW==='novice'?'cal':'novice');
    }
  });

  // 訓練量風險晶片：展開對應檢核列表
  $('summaryRisk').addEventListener('click', ()=>{
    const det = document.querySelector('section.card details[open], section.card details'); // 找到進階預估區的 details
    const riskDetails = document.querySelector('section.card h3 + .numbers + ul + .hint, section.card details summary') // 防守式選擇
    const container = document.querySelector('section.card h3:nth-child(1)');
    const d = document.querySelector('section.card details summary').parentElement;
    d.open = true;
    d.scrollIntoView({behavior:'smooth', block:'center'});
  });

  // 風險 & 賽事欄位變動即時刷新摘要
  ['maxLongD','maxLongG','maxLongTime','wkAvgD','wkAvgG','raceD','raceG','raceDes','raceCutoff','bufferPct']
    .forEach(id=>{ const el=$(id); if(el) el.addEventListener('input', ()=>predictFinish()); });

  // 時間欄位遮罩（輸入中只插冒號）與失焦驗證（補零）
  [['time','timeErr'],['raceCutoff','raceCutoffErr'],['maxLongTime','maxTimeErr']].forEach(([id,err])=>{
    const el=$(id); if(!el) return;
    el.addEventListener('input', ()=>maskTime(el));
    el.addEventListener('blur',  ()=>validateTime(el,err));
  });

  // pdown/gdown 防呆
  if($('pdown')){ $('pdown').addEventListener('input', validatePDown); $('pdown').addEventListener('blur', blurPDown); }
  if($('gdown')){ $('gdown').addEventListener('input', validateGDown); $('gdown').addEventListener('blur', blurGDown); }

  compute(); plan(); predictFinish(); renderHistory();

  // PWA 自動更新
  if(location.protocol!=='file:' && 'serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(()=>{
      navigator.serviceWorker.addEventListener('controllerchange', ()=>window.location.reload());
    }).catch(()=>{});
  }
});
