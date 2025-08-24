// ===== 小工具 =====
const $ = (id) => document.getElementById(id);

function toSeconds(hms){
  if(!hms||typeof hms!=='string') return NaN;
  const parts=hms.split(':').map(s=>s.trim());
  if(parts.length===3){ const [h,m,s]=parts.map(Number); return h*3600+m*60+s; }
  if(parts.length===2){ const [m,s]=parts.map(Number); return m*60+s; }
  if(parts.length===1){ return Number(parts[0]); }
  return NaN;
}
function secondsToHMS(totalSec){
  if(!isFinite(totalSec)) return '—';
  const sign=totalSec<0?'-':'';
  totalSec=Math.abs(totalSec);
  const h=Math.floor(totalSec/3600);
  const m=Math.floor((totalSec%3600)/60);
  const s=Math.round(totalSec%60);
  const pad=n=>n.toString().padStart(2,'0');
  return `${sign}${h}:${pad(m)}:${pad(s)}`;
}
function explainHoursFromSeconds(T){
  if(!isFinite(T)) return {hours:NaN,text:'T = —'};
  const h=Math.floor(T/3600), m=Math.floor((T%3600)/60), s=Math.round(T%60);
  const hours=T/3600;
  return {hours,text:`T = ${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')} = ${h} + ${m}/60 + ${s}/3600 = ${hours.toFixed(3)} h`};
}
function paceToSecPerKm(str){ if(!str) return NaN; const a=str.split(':').map(Number); if(a.length!==2) return NaN; return a[0]*60+a[1]; }
function secPerKmToPace(sec){ if(!isFinite(sec)||sec<=0) return '—'; const m=Math.floor(sec/60), s=Math.round(sec%60); return `${m}:${s.toString().padStart(2,'0')}`; }
function fmt(n,d=2){ return isFinite(n)?Number(n).toFixed(d):'—'; }
function parseNum(id){ const v=$(id).value.trim(); return v===''?NaN:Number(v); }
function parsePaceStr(id){ const v=$(id).value.trim(); return v?paceToSecPerKm(v):NaN; }

// ===== EP 模型 =====
function ep(D,G){ return (Number(D)||0) + (Number(G)||0)/100; }
function eph(EP,T){ const h=(Number(T)||0)/3600; return h>0? EP/h : NaN; }
function epace(EP,T){ const v=eph(EP,T); if(!isFinite(v)||v<=0) return '—'; return secPerKmToPace((1/v)*3600); }
function ep_cal(D,G,Des,R){
  const down = (!isFinite(R)||R<=0) ? 0 : (Number(Des)||0)/R;
  return (Number(D)||0) + (Number(G)||0)/100 + down;
}
function target_eph_from_cutoff(D,G,Des,cutoff_sec,R){
  const EP=ep_cal(D,G,Des,R), h=(Number(cutoff_sec)||0)/3600;
  return h>0? EP/h : NaN;
}
function train_time_from_target_eph(d,g,des,targetEPH,R){
  const EPt=ep_cal(d,g,des,R);
  if(!isFinite(targetEPH)||targetEPH<=0) return NaN;
  return (EPt/targetEPH)*3600;
}
function calibrate_r_loss(T_sec, Des_m, p_down_pct, Pflat_spk, Pdown_spk, g_down_pct){
  const T=Number(T_sec)||0, Des=Number(Des_m)||0, pDown=(Number(p_down_pct)||0)/100;
  const Pflat=Number(Pflat_spk)||NaN, Pdown=Number(Pdown_spk)||NaN, gDown=Number(g_down_pct)||NaN;
  if(T<=0||Des<=0||pDown<=0||!isFinite(Pflat)) return { rloss: NaN, method:'preset', delta_down: NaN };
  const Tdown=pDown*T;
  let d_down_km;
  if(isFinite(Pdown)){ d_down_km=Tdown/Pdown; }
  else{
    if(!isFinite(gDown)||gDown<=0) return { rloss: NaN, method:'preset', delta_down: NaN };
    d_down_km=(Des/(gDown/100))/1000;
  }
  const D_eq_down=Tdown/Pflat;
  const delta=Math.max(0, D_eq_down - d_down_km);
  if(delta<=0) return { rloss: Infinity, method: isFinite(Pdown)?'pace_based':'slope_based', delta_down:0 };
  let r=Des/delta; if(r<80) r=80; if(r>800) r=800;
  return { rloss:r, method: isFinite(Pdown)?'pace_based':'slope_based', delta_down:delta };
}

// ===== 歷史 =====
const HISTORY_KEY='eph_history_v1';
const loadHistory=()=>{ try{return JSON.parse(localStorage.getItem(HISTORY_KEY))||[]}catch{return []}};
const saveHistory=(l)=>localStorage.setItem(HISTORY_KEY,JSON.stringify(l));
function pushHistory(entry){ const l=loadHistory(); l.unshift(entry); if(l.length>20) l.pop(); saveHistory(l); renderHistory(); }
function renderHistory(){
  const list=loadHistory(), el=$('historyList');
  if(!el) return;
  if(!list.length){ el.innerHTML='<div class="hint">尚無紀錄</div>'; return; }
  el.innerHTML = `<table class="table"><thead><tr><th>時間</th><th>類型</th><th class="code">摘要</th></tr></thead><tbody>${
    list.map(x=>`<tr><td>${new Date(x.ts).toLocaleString()}</td><td>${x.type}</td><td class="code">${x.summary||''}</td></tr>`).join('')
  }</tbody></table>`;
}

// ===== 全域狀態 =====
let LAST_STATE=null;
let PRED_STATE=null; // 供 Summary Bar 使用

// ===== 計算：我的訓練 EP/EPH =====
function compute(){
  const D=parseNum('dist'), G=parseNum('gain'), Des=parseNum('descent');
  const T=toSeconds($('time').value.trim());
  const rlossPreset=parseNum('rloss');
  const Pflat=parsePaceStr('pflat'), pDownPct=parseNum('pdown');
  const Pdown=parsePaceStr('pdownpace'), gDown=parseNum('gdown');

  // 新手
  const EPb=ep(D,G), EPHb=eph(EPb,T), EPaceb=epace(EPb,T);
  const timeExplain=explainHoursFromSeconds(T);
  $('basicEP').textContent=fmt(EPb,2);
  $('basicEPH').textContent=fmt(EPHb,2);
  $('basicEPace').textContent=EPaceb||'—';
  $('basicSteps').textContent=
`${timeExplain.text}
EP = D + G/100 = ${fmt(D,2)} + ${fmt(G,0)}/100 = ${fmt(EPb,2)} ekm
EPH = EP / (T/3600) = ${fmt(EPb,2)} / (${fmt(T/3600,3)} h) = ${fmt(EPHb,2)} ekm/h
EPace = 時間/EP = ${secondsToHMS(T)} ÷ ${fmt(EPb,2)} = ${EPaceb} 分/ekm`;

  // 校準 R_loss
  let cal={ rloss: rlossPreset, method:'preset', delta_down: NaN };
  if(isFinite(Pflat)&&isFinite(pDownPct)&&isFinite(Des)&&isFinite(T)&&T>0&&Des>0&&pDownPct>0){
    cal = calibrate_r_loss(T, Des, pDownPct, Pflat, Pdown, gDown);
  }
  const r_use = isFinite(cal.rloss) ? cal.rloss : rlossPreset;

  // 校準結果
  const EPc=ep_cal(D,G,Des,r_use), EPHc=eph(EPc,T), EPacec=epace(EPc,T);
  $('calEP').textContent=fmt(EPc,2);
  $('calEPH').textContent=fmt(EPHc,2);
  $('calEPace').textContent=EPacec||'—';
  $('calMeta').innerHTML=`R<sub>loss</sub>（使用中）＝<strong>${fmt(r_use,0)}</strong>（${cal.method}）`;
  $('calSteps').textContent=
`${timeExplain.text}
EP_cal = D + G/100 + Des/R_loss
       = ${fmt(D,2)} + ${fmt(G,0)}/100 + ${isFinite(Des)?fmt(Des,0):'0'}/${fmt(r_use,0)}
       = ${fmt(EPc,2)} ekm
EPH_cal = EP_cal / (T/3600) = ${fmt(EPc,2)} / (${fmt(T/3600,3)} h) = ${fmt(EPHc,2)} ekm/h
EPace_cal = ${secondsToHMS(T)} ÷ ${fmt(EPc,2)} = ${EPacec} 分/ekm`;

  // 差異提示
  if(isFinite(EPHb)&&isFinite(EPHc)){
    const diffPct=(EPHc-EPHb)/EPHb*100;
    $('deltaNote').textContent = Math.abs(diffPct)>=10
      ? `⚠️ 差異 ${fmt(diffPct,1)}%（下降成本顯著，建議採校準版）`
      : `差異 ${fmt(diffPct,1)}%（幾乎一致）`;
  } else $('deltaNote').textContent='—';

  LAST_STATE = { D,G,Des,T, EPH_basic:EPHb, EPH_cal:EPHc, r_use, mode:isFinite(EPHc)?'校準版':'新手版' };

  pushHistory({ ts:Date.now(), type:'EPH 計算',
    summary:`D=${fmt(D,2)}km,G=${fmt(G,0)}m,Des=${isFinite(Des)?fmt(Des,0):'-'}m,T=${secondsToHMS(T)}, EPH=${fmt(EPHb,2)} / ${fmt(EPHc,2)} (Rloss=${fmt(r_use,0)})`
  });

  predictFinish();
}

// ===== 計算：賽事→訓練（同卡顯示） =====
function plan(){
  const D=parseNum('raceD'), G=parseNum('raceG'), Des=parseNum('raceDes');
  const cutoff=toSeconds($('raceCutoff').value.trim());
  const d=parseNum('trainD'), g=parseNum('trainG'), des=parseNum('trainDes');
  const bufferPct=parseNum('bufferPct')||0;

  const rlossPreset=parseNum('rloss');
  const Pflat=parsePaceStr('pflat'), pDownPct=parseNum('pdown');
  const Pdown=parsePaceStr('pdownpace'), gDown=parseNum('gdown');

  // 新手
  const EPH_race_basic = target_eph_from_cutoff(D,G,0,cutoff,Infinity);
  const t_train_basic  = train_time_from_target_eph(d,g,0,EPH_race_basic,Infinity) * (1+bufferPct/100);
  const explainCutoff=explainHoursFromSeconds(cutoff);

  $('raceBasicEPH').textContent=fmt(EPH_race_basic,2);
  $('trainBasicTime').textContent=secondsToHMS(t_train_basic);
  $('planBasicSteps').textContent=
`${explainCutoff.text}
EP_race = D + G/100 = ${fmt(D,2)} + ${fmt(G,0)}/100 = ${fmt(D+G/100,2)} ekm
EPH_race = ${fmt(D+G/100,2)} ÷ ${fmt(cutoff/3600,3)} = ${fmt(EPH_race_basic,2)} ekm/h
EP_train = d + g/100 = ${fmt(d,2)} + ${fmt(g,0)}/100 = ${fmt(d+g/100,2)} ekm
所需時間 = EP_train / EPH_race × 3600 = ${secondsToHMS(t_train_basic)}`;

  // 校準 Rloss
  let cal={ rloss: rlossPreset, method:'preset' };
  if(isFinite(Pflat)&&isFinite(pDownPct)&&isFinite(Des)&&isFinite(cutoff)&&cutoff>0&&Des>0&&pDownPct>0){
    cal = calibrate_r_loss(cutoff, Des, pDownPct, Pflat, Pdown, gDown);
  }
  const r_use=isFinite(cal.rloss)?cal.rloss:rlossPreset;

  const EPH_race_cal = target_eph_from_cutoff(D,G,Des,cutoff,r_use);
  const t_train_cal  = train_time_from_target_eph(d,g,des,EPH_race_cal,r_use) * (1+bufferPct/100);

  $('raceCalEPH').textContent=fmt(EPH_race_cal,2);
  $('trainCalTime').textContent=secondsToHMS(t_train_cal);
  $('planCalSteps').textContent=
`${explainCutoff.text}
EP_race_cal = D + G/100 + Des/R_loss = ${fmt(D,2)} + ${fmt(G,0)}/100 + ${isFinite(Des)?fmt(Des,0):'0'}/${fmt(r_use,0)}
EPH_race_cal = ${fmt(D + G/100 + (isFinite(Des)?Des/r_use:0),2)} ÷ ${fmt(cutoff/3600,3)} = ${fmt(EPH_race_cal,2)} ekm/h
EP_train_cal = d + g/100 + des/R_loss = ${fmt(d + g/100 + (isFinite(des)?des/r_use:0),2)} ekm
所需時間 = EP_train_cal / EPH_race_cal × 3600 = ${secondsToHMS(t_train_cal)}`;

  pushHistory({ ts:Date.now(), type:'賽事→訓練',
    summary:`Race ${fmt(D,2)}km/+${fmt(G,0)}m T=${secondsToHMS(cutoff)} → Train ${fmt(d,2)}km/+${fmt(g,0)}m : ${secondsToHMS(t_train_basic)} / ${secondsToHMS(t_train_cal)} (Rloss=${fmt(r_use,0)})`
  });

  predictFinish();
}

// ===== 耐力衰退 =====
function staminaFactor(r){
  if(!isFinite(r)||r<=1) return 1;
  let f=Math.pow(0.93, Math.log2(r)); // 每加倍 -7%
  if(f<0.70) f=0.70;
  if(f>1) f=1;
  return f;
}

// ===== 風險檢核（含單次最長爬升） =====
function colorByRatio(x,g,y){
  if(!isFinite(x)||x<=0) return {cls:'red', label:'資料不足'};
  if(x>=g) return {cls:'green', label:'良好'};
  if(x>=y) return {cls:'yellow', label:'注意'};
  return {cls:'red', label:'偏低'};
}
function renderRisk(_raceEP_forInfo, predT){
  const list=$('riskList'); if(!list) return {factor:1, level:'—'};
  const raceD=parseNum('raceD')||0, raceG=parseNum('raceG')||0;

  const maxD=parseNum('maxLongD');
  const maxG=parseNum('maxLongG');
  const maxT=toSeconds($('maxLongTime').value.trim());
  const wkD=parseNum('wkAvgD');
  const wkG=parseNum('wkAvgG');

  const r0=(isFinite(maxG)&&raceG>0)? maxG/raceG : NaN;       // 最長爬升
  const r1=(isFinite(maxD)&&raceD>0)? maxD/raceD : NaN;       // 最長距離
  const r2=(isFinite(maxT)&&isFinite(predT)&&predT>0)? maxT/predT : NaN; // 最長時間 vs 預估
  const r3=(isFinite(wkD)&&raceD>0)? wkD/raceD : NaN;         // 近4週距離
  const r4=(isFinite(wkG)&&raceG>0)? wkG/raceG : NaN;         // 近4週爬升

  const c0=colorByRatio(r0,0.60,0.40);
  const c1=colorByRatio(r1,0.40,0.25);
  const c2=colorByRatio(r2,0.70,0.50);
  const c3=colorByRatio(r3,0.90,0.60);
  const c4=colorByRatio(r4,1.00,0.60);

  const target_r0=0.60*raceG, target_r1=0.40*raceD, target_r2=0.70*(predT||0), target_r3=0.90*raceD, target_r4=1.00*raceG;

  const pct=(x)=>isFinite(x)?`${fmt(x*100,0)}%`:'—';
  const sugg=(type,cur,tgt)=>{
    if(!isFinite(tgt)) return '';
    const label = type==='time'? secondsToHMS(tgt) : (type==='gain'? `${Math.round(tgt)} m` : `${fmt(tgt,2)} km`);
    if(!isFinite(cur)) return `｜建議 ≥ ${label}`;
    if(cur>=tgt) return `｜目標 ≥ ${label} ✔`;
    const gap = type==='time'? secondsToHMS(tgt-cur) : (type==='gain'? `${Math.round(tgt-cur)} m` : `${fmt(tgt-cur,2)} km`);
    return `｜建議 ≥ ${label}（尚差 ${gap}）`;
  };

  const factorOf=(cls,type)=>{
    if(cls==='green') return 1;
    if(cls==='yellow'){ if(type==='r0')return 0.97; if(type==='r2')return 0.95; if(type==='r1')return 0.97; if(type==='r3')return 0.97; if(type==='r4')return 0.98; }
    if(type==='r0')return 0.93; if(type==='r2')return 0.88; if(type==='r1')return 0.90; if(type==='r3')return 0.92; if(type==='r4')return 0.94;
    return 1;
  };
  const f0=factorOf(c0.cls,'r0'), f1=factorOf(c1.cls,'r1'), f2=factorOf(c2.cls,'r2'), f3=factorOf(c3.cls,'r3'), f4=factorOf(c4.cls,'r4');
  const factor=f0*f1*f2*f3*f4;

  list.innerHTML=[
    `<li>● 單次最長爬升/比賽爬升：${pct(r0)}（${c0.label}）${sugg('gain',maxG,target_r0)}</li>`,
    `<li>● 單次最長距離/比賽距離：${pct(r1)}（${c1.label}）${sugg('km',maxD,target_r1)}</li>`,
    `<li>● 單次最長時間/預估完賽：${pct(r2)}（${c2.label}）${sugg('time',maxT,target_r2)}</li>`,
    `<li>● 近四週平均距離/比賽距離：${pct(r3)}（${c3.label}）${sugg('km',wkD,target_r3)}</li>`,
    `<li>● 近四週平均爬升/比賽爬升：${pct(r4)}（${c4.label}）${sugg('gain',wkG,target_r4)}</li>`
  ].join('');

  // 給 summary 用的等級
  let level='—';
  const reds=[c0,c1,c2,c3,c4].filter(x=>x.cls==='red').length;
  const yellows=[c0,c1,c2,c3,c4].filter(x=>x.cls==='yellow').length;
  if(reds>=2 || (reds===1&&yellows>=2)) level='高';
  else if(reds===0 && yellows<=2) level='低';
  else level='中';

  return {factor, level};
}

// ===== 反推：完成關門所需「訓練 EPH」 =====
function requiredTrainingEPHForCutoff(EP_race, cutoffSec, T_ref, riskFactor, bufferPct){
  if(!isFinite(EP_race)||EP_race<=0 || !isFinite(cutoffSec)||cutoffSec<=0 || !isFinite(T_ref)||T_ref<=0 || !isFinite(riskFactor)||riskFactor<=0) return NaN;
  const buf = 1 + (Number(bufferPct)||0)/100;

  const adjTime=(EPH)=>{
    const t_pred=(EP_race/EPH)*3600;
    const F = staminaFactor(t_pred/T_ref);
    return (EP_race / (EPH*F*riskFactor)) * 3600 * buf;
  };

  let lo=0.10, hi=100;
  for(let i=0;i<60;i++){
    const mid=(lo+hi)/2, t=adjTime(mid);
    if(t>cutoffSec) lo=mid; else hi=mid;
  }
  return hi;
}

// ===== 完賽預估（含風險/緩衝），並更新 Summary Bar =====
function predictFinish(){
  if(!LAST_STATE) return;

  const EPHb=LAST_STATE.EPH_basic, EPHc=LAST_STATE.EPH_cal, r_use=LAST_STATE.r_use;
  const D=parseNum('raceD'), G=parseNum('raceG'), Des=parseNum('raceDes');
  const cutoff=toSeconds($('raceCutoff').value.trim());
  const bufferPct=parseNum('bufferPct')||0;

  const T_train = LAST_STATE.T || NaN;
  const T_ref = Math.max(2400, T_train || 0);

  // 新手流
  const EP_race_basic = ep(D,G);
  let t_pred_basic = isFinite(EPHb)&&EPHb>0 ? (EP_race_basic/EPHb)*3600 : NaN;
  let Fb = isFinite(t_pred_basic)&&isFinite(T_ref)&&T_ref>0 ? staminaFactor(t_pred_basic/T_ref) : 1;

  const risk = renderRisk(EP_race_basic, t_pred_basic);
  let t_pred_basic_adj = isFinite(t_pred_basic) ? (EP_race_basic/(EPHb*Fb*risk.factor))*3600*(1+bufferPct/100) : NaN;

  $('predBasicTime').textContent=secondsToHMS(t_pred_basic_adj);
  let basicVerd='—', needBasic='';
  if(isFinite(t_pred_basic_adj) && isFinite(cutoff) && cutoff>0){
    const diff=cutoff-t_pred_basic_adj;
    if(diff>=0){ basicVerd=`✅ 關門內（餘裕 ${secondsToHMS(diff)}）`; }
    else{
      basicVerd=`⚠️ 可能超過（差 ${secondsToHMS(-diff)}）`;
      const needEPH=requiredTrainingEPHForCutoff(EP_race_basic, cutoff, T_ref, risk.factor, bufferPct);
      const EP_train_basic=ep(LAST_STATE.D, LAST_STATE.G);
      const needT=isFinite(needEPH)&&needEPH>0 ? (EP_train_basic/needEPH)*3600 : NaN;
      needBasic = (isFinite(needEPH)&&isFinite(needT))
        ? `要在關門內：訓練 EPH ≥ ${fmt(needEPH,2)} ekm/h；以你這段訓練需 ≤ ${secondsToHMS(needT)}`
        : '';
    }
  }
  $('predBasicNote').textContent=basicVerd;
  $('predBasicNeed').textContent=needBasic;

  // 校準流
  const EP_race_cal = ep_cal(D,G,Des,r_use);
  let t_pred_cal = isFinite(EPHc)&&EPHc>0 ? (EP_race_cal/EPHc)*3600 : NaN;
  let Fc = isFinite(t_pred_cal)&&isFinite(T_ref)&&T_ref>0 ? staminaFactor(t_pred_cal/T_ref) : 1;

  let t_pred_cal_adj = isFinite(t_pred_cal) ? (EP_race_cal/(EPHc*Fc*risk.factor))*3600*(1+bufferPct/100) : NaN;
  $('predCalTime').textContent=secondsToHMS(t_pred_cal_adj);
  let calVerd='—', needCal='';
  if(isFinite(t_pred_cal_adj) && isFinite(cutoff) && cutoff>0){
    const diff=cutoff-t_pred_cal_adj;
    if(diff>=0){ calVerd=`✅ 關門內（餘裕 ${secondsToHMS(diff)}）`; }
    else{
      calVerd=`⚠️ 可能超過（差 ${secondsToHMS(-diff)}）`;
      const needEPH=requiredTrainingEPHForCutoff(EP_race_cal, cutoff, T_ref, risk.factor, bufferPct);
      const EP_train_cal=ep_cal(LAST_STATE.D,LAST_STATE.G,LAST_STATE.Des,r_use);
      const needT=isFinite(needEPH)&&needEPH>0 ? (EP_train_cal/needEPH)*3600 : NaN;
      needCal=(isFinite(needEPH)&&isFinite(needT))
        ? `要在關門內：訓練 EPH ≥ ${fmt(needEPH,2)} ekm/h；以你這段訓練需 ≤ ${secondsToHMS(needT)}`
        : '';
    }
  }
  $('predCalNote').textContent=calVerd;
  $('predCalNeed').textContent=needCal;

  if(isFinite(t_pred_basic_adj) || isFinite(t_pred_cal_adj)){
    pushHistory({ ts:Date.now(), type:'完賽預估',
      summary:`Pred ${secondsToHMS(t_pred_basic_adj)} / ${secondsToHMS(t_pred_cal_adj)}（含耐力與風險）`
    });
  }

  // 準備 Summary Bar 狀態
  const chosen = isFinite(LAST_STATE.EPH_cal) ? LAST_STATE.EPH_cal : LAST_STATE.EPH_basic;
  PRED_STATE = {
    eph: chosen, mode: LAST_STATE.mode,
    basicTime: secondsToHMS(t_pred_basic_adj), basicVerd,
    calTime: secondsToHMS(t_pred_cal_adj), calVerd,
    riskLevel: risk.level
  };
  updateSummaryBar();
}

// ===== Sticky Summary Bar 更新 =====
function updateSummaryBar(){
  const s=PRED_STATE, ls=LAST_STATE;
  if(!s||!ls){ $('summaryEPH').textContent='—'; return; }

  $('summaryEPH').textContent = isFinite(s.eph)? `${fmt(s.eph,2)} ekm/h` : '—';
  $('summaryMode').textContent = `（${ls.mode}）`;

  $('summaryBasicTime').textContent = s.basicTime||'—';
  $('summaryCalTime').textContent   = s.calTime||'—';

  const setBadge=(el,text)=>{
    el.className='badge';
    if(text.startsWith('✅')) el.classList.add('ok');
    else if(text.startsWith('⚠️')) el.classList.add('warn');
    el.textContent=text||'—';
  };
  setBadge($('summaryBasicVerdict'), s.basicVerd);
  setBadge($('summaryCalVerdict'), s.calVerd);

  const riskEl=$('summaryRisk');
  riskEl.textContent=`風險：${s.riskLevel||'—'}`;
  riskEl.className='badge';
  if(s.riskLevel==='低') riskEl.classList.add('ok');
  else if(s.riskLevel==='中') riskEl.classList.add('warn');
  else if(s.riskLevel==='高') riskEl.classList.add('warn');
}

// ===== 分享圖（1000x420） =====
async function makeSharePNG(){
  if(!LAST_STATE){ compute(); }
  const s=LAST_STATE||{};
  const chosenEPH = isFinite(s.EPH_cal)? s.EPH_cal : s.EPH_basic;
  const ephText = `EPH ${fmt(chosenEPH,2)} ekm/h`;

  const canvas=$('shareCanvas'); canvas.width=1000; canvas.height=420;
  const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);

  const x=56, y0=68, line=72, H=canvas.height;
  ctx.fillStyle='#FFFFFF'; ctx.shadowColor='rgba(0,0,0,0.25)'; ctx.shadowBlur=6;

  ctx.font='700 50px system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans","PingFang TC","Microsoft JhengHei",sans-serif';
  ctx.fillText('Trail EPH', x, y0);

  ctx.shadowBlur=0;
  ctx.font='500 42px system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans","PingFang TC","Microsoft JhengHei",sans-serif';
  let y=y0+line;
  ctx.fillText(`距離 ${fmt(s.D,2)} km`, x, y); y+=line;
  const desTxt=(isFinite(s.Des)&&s.Des>0)?` | 下降 ${Math.round(s.Des)} m`:''; 
  ctx.fillText(`爬升 +${Math.round(s.G||0)} m${desTxt}`, x, y); y+=line;
  ctx.fillText(`時間 ${secondsToHMS(s.T||0)}`, x, y);

  ctx.font='800 84px system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans","PingFang TC","Microsoft JhengHei",sans-serif';
  ctx.fillText(ephText, x, H-48);

  const blob = await new Promise(res=>canvas.toBlob(res,'image/png'));
  const url=URL.createObjectURL(blob);
  const a=$('downloadLink'); a.href=url; a.download=`eph_${Date.now()}.png`; a.click();
  if(location.protocol!=='file:' && navigator.clipboard && window.ClipboardItem){
    try{ await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]); }catch{}
  }
}

// ===== 時間輸入遮罩（hh:mm:ss） =====
function maskTimeInput(el){
  const v = el.value.replace(/[^\d]/g,'').slice(0,6);
  let out=v;
  if(v.length>=3) out = v.slice(0,2)+':'+v.slice(2);
  if(v.length>=5) out = out.slice(0,5)+':'+v.slice(4);
  el.value = out;
}
function padTimeOnBlur(el){
  const s=toSeconds(el.value);
  if(!isFinite(s)) return;
  el.value = secondsToHMS(s);
}

// ===== 綁定與初始化 =====
document.addEventListener('DOMContentLoaded', ()=>{
  $('calcBtn').addEventListener('click', compute);
  $('resetBtn').addEventListener('click', ()=>{
    ['dist','gain','descent','time','pdown','pdownpace','gdown','rloss','pflat'].forEach(id=>$(id).value='');
    compute();
  });

  $('planBtn').addEventListener('click', ()=>{ plan(); predictFinish(); });
  $('planResetBtn').addEventListener('click', ()=>{
    ['raceD','raceG','raceDes','raceCutoff','trainD','trainG','trainDes','bufferPct'].forEach(id=>$(id).value='');
    plan(); predictFinish();
  });

  $('clearHistoryBtn').addEventListener('click', ()=>{ localStorage.removeItem(HISTORY_KEY); renderHistory(); });
  $('shareBtn').addEventListener('click', makeSharePNG);

  // Summary Bar 行動
  $('summaryRecalc').addEventListener('click', ()=>{ compute(); plan(); predictFinish(); });
  $('summaryShare').addEventListener('click', makeSharePNG);

  // 風險/賽事輸入變動即時更新
  ['maxLongD','maxLongG','maxLongTime','wkAvgD','wkAvgG','raceD','raceG','raceDes','raceCutoff','bufferPct']
    .forEach(id=>{ const el=$(id); if(el) el.addEventListener('input', ()=>predictFinish()); });

  // 時間輸入遮罩 + 補零
  ['time','raceCutoff','maxLongTime'].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener('input', ()=>maskTimeInput(el));
    el.addEventListener('blur',  ()=>padTimeOnBlur(el));
  });

  compute(); plan(); predictFinish(); renderHistory();

  // PWA：新版自動更新
  if(location.protocol!=='file:' && 'serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(()=>{
      navigator.serviceWorker.addEventListener('controllerchange', ()=>window.location.reload());
    }).catch(()=>{});
  }
});
