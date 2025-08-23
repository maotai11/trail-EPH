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
function explainHoursFromSeconds(T){
  if(!isFinite(T)) return {h:0,m:0,s:0,hours:NaN, text:'T = —'};
  const h=Math.floor(T/3600); const m=Math.floor((T%3600)/60); const s=Math.round(T%60);
  const pad=n=>n.toString().padStart(2,'0');
  const hms=`${h}:${pad(m)}:${pad(s)}`;
  const hours=T/3600;
  return {h,m,s,hours,text:`T = ${hms} = ${h} h + ${m} m + ${s} s = ${h} + ${m}/60 + ${s}/3600 = ${hours.toFixed(3)} h`};
}
function secondsToHMS(totalSec){
  if(!isFinite(totalSec)) return '—';
  const sign = totalSec<0?'-':'';
  totalSec = Math.abs(totalSec);
  const h=Math.floor(totalSec/3600); const m=Math.floor((totalSec%3600)/60); const s=Math.round(totalSec%60);
  const pad=n=>n.toString().padStart(2,'0');
  return `${sign}${h}:${pad(m)}:${pad(s)}`;
}
function paceToSecPerKm(paceStr){ if(!paceStr) return NaN; const parts=paceStr.split(':').map(Number); if(parts.length!==2) return NaN; return parts[0]*60+parts[1]; }
function secPerKmToPace(sec){ if(!isFinite(sec)||sec<=0) return '—'; const m=Math.floor(sec/60), s=Math.round(sec%60); return `${m}:${s.toString().padStart(2,'0')}`; }
function fmt(num, digits=2){ return isFinite(num)?Number(num).toFixed(digits):'—'; }
function parseNum(id){ const v=$(id).value.trim(); return v===''?NaN:Number(v); }
function parsePaceStr(id){ const v=$(id).value.trim(); return v?paceToSecPerKm(v):NaN; }

// ===== 模型計算 =====
function ep(distance_km, gain_m){ const d=Number(distance_km)||0, g=Number(gain_m)||0; return d + g/100; }
function eph(ep_ekm, time_sec){ const h=(Number(time_sec)||0)/3600; return h>0? ep_ekm/h : NaN; }
function epace(ep_ekm, time_sec){ const v=eph(ep_ekm,time_sec); if(!isFinite(v)||v<=0) return NaN; return secPerKmToPace((1/v)*3600); }
function ep_cal(distance_km, gain_m, descent_m, r_loss){
  const d=Number(distance_km)||0, g=Number(gain_m)||0, des=Number(descent_m)||0, r=Number(r_loss)||Infinity;
  const downCost = (!isFinite(r)||r<=0) ? 0 : des/r;
  return d + g/100 + downCost;
}
function target_eph_from_cutoff(D,G,Des,cutoff_sec,r_loss){
  const EP=ep_cal(D,G,Des,r_loss), h=(Number(cutoff_sec)||0)/3600; return h>0? EP/h : NaN;
}
function train_time_from_target_eph(d,g,des,target_eph,r_loss){
  const EPt=ep_cal(d,g,des,r_loss); if(!isFinite(target_eph)||target_eph<=0) return NaN; return (EPt/target_eph)*3600;
}
function calibrate_r_loss(T_sec, Des_m, p_down_pct, Pflat_spk, Pdown_spk, g_down_pct){
  const T=Number(T_sec)||0, Des=Number(Des_m)||0, pDown=(Number(p_down_pct)||0)/100;
  const Pflat=Number(Pflat_spk)||NaN, Pdown=Number(Pdown_spk)||NaN, gDown=Number(g_down_pct)||NaN;
  if(T<=0||Des<=0||pDown<=0||!isFinite(Pflat)) return { rloss: NaN, method:'insufficient', delta_down: NaN };
  const Tdown=pDown*T;
  let d_down_km;
  if(isFinite(Pdown)){ d_down_km=Tdown/Pdown; }
  else{
    if(!isFinite(gDown)||gDown<=0) return { rloss: NaN, method:'insufficient', delta_down: NaN };
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
function loadHistory(){ try{ return JSON.parse(localStorage.getItem(HISTORY_KEY))||[] }catch{return []} }
function saveHistory(list){ localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }
function pushHistory(entry){ const list=loadHistory(); list.unshift(entry); if(list.length>20) list.pop(); saveHistory(list); renderHistory(); }
function renderHistory(){
  const list=loadHistory(), el=$('historyList');
  if(!el) return;
  if(!list.length){ el.innerHTML='<div class="hint">尚無紀錄</div>'; return; }
  const rows=list.map(item=>{
    const when=new Date(item.ts).toLocaleString();
    return `<tr><td>${when}</td><td>${item.type}</td><td class="code">${item.summary||''}</td></tr>`;
  }).join('');
  el.innerHTML=`<table class="table"><thead><tr><th>時間</th><th>類型</th><th>摘要</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ===== 狀態（給分享圖/預估/風險用） =====
let LAST_STATE = null;

// ===== 計算：我的訓練 =====
function compute(){
  const D=parseNum('dist'), G=parseNum('gain'), Des=parseNum('descent');
  const T=toSeconds($('time').value.trim());
  const rlossPreset=parseNum('rloss');
  const Pflat=parsePaceStr('pflat'), pDownPct=parseNum('pdown');
  const Pdown=parsePaceStr('pdownpace'), gDown=parseNum('gdown');

  // 新手
  const EPb=ep(D,G), EPHb=eph(EPb,T), EPaceb=epace(EPb,T);
  const timeExplain = explainHoursFromSeconds(T);
  $('basicEP').textContent=fmt(EPb,2);
  $('basicEPH').textContent=fmt(EPHb,2);
  $('basicEPace').textContent=EPaceb||'—';
  $('basicSteps').textContent=
`${timeExplain.text}
EP = D + G/100 = ${fmt(D,2)} + ${fmt(G,0)}/100 = ${fmt(EPb,2)} ekm
EPH = EP / (T/3600) = ${fmt(EPb,2)} / (${fmt(T/3600,3)} h) = ${fmt(EPHb,2)} ekm/h
EPace = 時間/EP = ${secondsToHMS(T)} ÷ ${fmt(EPb,2)} = ${EPaceb} 分/ekm`;

  // 校準 R_loss（可留空）
  let cal={ rloss: rlossPreset, method:'preset', delta_down: NaN };
  if(isFinite(Pflat)&&isFinite(pDownPct)&&isFinite(Des)&&isFinite(T)&&T>0&&Des>0&&pDownPct>0){
    cal = calibrate_r_loss(T, Des, pDownPct, Pflat, Pdown, gDown);
  }
  const r_use = isFinite(cal.rloss) ? cal.rloss : rlossPreset;

  // 校準版
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

  if(isFinite(EPHb)&&isFinite(EPHc)){
    const diffPct=(EPHc-EPHb)/EPHb*100;
    $('deltaNote').textContent = Math.abs(diffPct)>=10
      ? `⚠️ 新手 vs 校準差異：${fmt(diffPct,1)}%。下降成本顯著，建議採用校準版。`
      : `新手與校準差異：${fmt(diffPct,1)}%。`;
  } else { $('deltaNote').textContent='—'; }

  LAST_STATE = { D, G, Des, T, EPH_basic: EPHb, EPH_cal: EPHc, r_use, mode: isFinite(EPHc)?'cal':'basic' };

  pushHistory({ ts:Date.now(), type:'EPH 計算',
    summary:`D=${fmt(D,2)}km, G=${fmt(G,0)}m, Des=${isFinite(Des)?fmt(Des,0):'-'}m, T=${secondsToHMS(T)}, EPH=${fmt(EPHb,2)} / EPH_cal=${fmt(EPHc,2)} (R_loss=${fmt(r_use,0)})`
  });

  predictFinish();
}

// ===== 計算：賽事→訓練時間 =====
function plan(){
  const D=parseNum('raceD'), G=parseNum('raceG'), Des=parseNum('raceDes');
  const cutoff=toSeconds($('raceCutoff').value.trim());
  const d=parseNum('trainD'), g=parseNum('trainG'), des=parseNum('trainDes');
  const bufferPct=parseNum('bufferPct')||0;

  const rlossPreset=parseNum('rloss');
  const Pflat=parsePaceStr('pflat'), pDownPct=parseNum('pdown');
  const Pdown=parsePaceStr('pdownpace'), gDown=parseNum('gdown');

  const EPH_race_basic = target_eph_from_cutoff(D,G,0,cutoff,Infinity);
  const t_train_basic  = train_time_from_target_eph(d,g,0,EPH_race_basic,Infinity) * (1+bufferPct/100);
  const explainCutoff = explainHoursFromSeconds(cutoff);
  $('raceBasicEPH').textContent=fmt(EPH_race_basic,2);
  $('trainBasicTime').textContent=secondsToHMS(t_train_basic);
  $('planBasicSteps').textContent=
`${explainCutoff.text}
EP_race = D + G/100 = ${fmt(D,2)} + ${fmt(G,0)}/100 = ${fmt(D + G/100,2)} ekm
EPH_race = EP_race / (T_cutoff/3600) = ${fmt(D + G/100,2)} ÷ ${fmt(cutoff/3600,3)} = ${fmt(EPH_race_basic,2)} ekm/h
EP_train = d + g/100 = ${fmt(d,2)} + ${fmt(g,0)}/100 = ${fmt(d + g/100,2)} ekm`;

  let cal={ rloss: rlossPreset, method:'preset' };
  if(isFinite(Pflat)&&isFinite(pDownPct)&&isFinite(Des)&&isFinite(cutoff)&&cutoff>0&&Des>0&&pDownPct>0){
    cal = calibrate_r_loss(cutoff, Des, pDownPct, Pflat, Pdown, gDown);
  }
  const r_use = isFinite(cal.rloss)?cal.rloss:rlossPreset;

  const EPH_race_cal = target_eph_from_cutoff(D,G,Des,cutoff,r_use);
  const t_train_cal  = train_time_from_target_eph(d,g,des,EPH_race_cal,r_use) * (1+bufferPct/100);
  $('raceCalEPH').textContent=fmt(EPH_race_cal,2);
  $('trainCalTime').textContent=secondsToHMS(t_train_cal);
  $('planCalSteps').textContent=
`${explainCutoff.text}
EP_race_cal = D + G/100 + Des/R_loss = ${fmt(D,2)} + ${fmt(G,0)}/100 + ${isFinite(Des)?fmt(Des,0):'0'}/${fmt(r_use,0)}
EPH_race_cal = EP_race_cal / (T_cutoff/3600) = ${fmt((D + G/100 + (isFinite(Des)?Des/r_use:0)),2)} ÷ ${fmt(cutoff/3600,3)} = ${fmt(EPH_race_cal,2)} ekm/h`;

  pushHistory({ ts:Date.now(), type:'賽事→訓練',
    summary:`Race ${fmt(D,2)}km/+${fmt(G,0)}m T=${secondsToHMS(cutoff)} → Train ${fmt(d,2)}km/+${fmt(g,0)}m : ${secondsToHMS(t_train_basic)} / ${secondsToHMS(t_train_cal)} (R_loss=${fmt(r_use,0)})`
  });

  predictFinish();
}

// ===== 耐力衰退（Stamina）係數 =====
function staminaFactor(r){
  if(!isFinite(r) || r<=1) return 1;
  let f = Math.pow(0.93, Math.log2(r));
  if(f<0.70) f=0.70;
  if(f>1) f=1;
  return f;
}

// ===== 新功能：以「我的訓練 EPH」預估賽事完賽時間（含耐力衰退） =====
function predictFinish(){
  if(!LAST_STATE) return;

  const EPHb = LAST_STATE.EPH_basic, EPHc = LAST_STATE.EPH_cal, r_use = LAST_STATE.r_use;
  const D=parseNum('raceD'), G=parseNum('raceG'), Des=parseNum('raceDes');
  const cutoff=toSeconds($('raceCutoff').value.trim());
  const bufferPct = parseNum('bufferPct')||0;

  const T_train = LAST_STATE.T || NaN;
  const T_ref = Math.max( toSeconds('0:40:00') || 2400, T_train || 0 ); // 最少 40 分當參考

  // 新手版：不含下降
  const EP_race_basic = ep(D,G);
  let t_pred_basic = isFinite(EPHb) && EPHb>0 ? (EP_race_basic/EPHb)*3600 : NaN;
  let Fb = isFinite(t_pred_basic)&&isFinite(T_ref)&&T_ref>0 ? staminaFactor(t_pred_basic / T_ref) : 1;
  let t_pred_basic_adj = isFinite(t_pred_basic) ? (EP_race_basic/(EPHb*Fb))*3600*(1+bufferPct/100) : NaN;
  $('predBasicTime').textContent = secondsToHMS(t_pred_basic_adj);
  if(isFinite(t_pred_basic_adj) && isFinite(cutoff) && cutoff>0){
    const diff = cutoff - t_pred_basic_adj;
    $('predBasicNote').textContent = diff>=0 ? `✅ 關門內（餘裕 ${secondsToHMS(diff)}）` : `⚠️ 可能超過（差 ${secondsToHMS(-diff)}）`;
  }else{ $('predBasicNote').textContent='—'; }
  $('predBasicSteps').textContent =
`EP_race = D + G/100 = ${fmt(D,2)} + ${fmt(G,0)}/100 = ${fmt(EP_race_basic,2)} ekm
以我的 EPH（新手） = ${fmt(EPHb,2)} ekm/h，先估 T_pred = ${secondsToHMS(t_pred_basic)}
耐力衰退：T_ref=${secondsToHMS(T_ref)}，r=T_pred/T_ref=${fmt(t_pred_basic/T_ref,2)} → F(r)=${fmt(Fb,3)}（下修 ${(1-Fb>0)?fmt((1-Fb)*100,1):'0'}%）
調整後 EPH = ${fmt(EPHb*Fb,2)}，加入緩衝 ${bufferPct||0}% → 預估 ${secondsToHMS(t_pred_basic_adj)}`;

  // 校準版：含下降
  const EP_race_cal = ep_cal(D,G,Des,r_use);
  let t_pred_cal = isFinite(EPHc) && EPHc>0 ? (EP_race_cal/EPHc)*3600 : NaN;
  let Fc = isFinite(t_pred_cal)&&isFinite(T_ref)&&T_ref>0 ? staminaFactor(t_pred_cal / T_ref) : 1;
  let t_pred_cal_adj = isFinite(t_pred_cal) ? (EP_race_cal/(EPHc*Fc))*3600*(1+bufferPct/100) : NaN;
  $('predCalTime').textContent = secondsToHMS(t_pred_cal_adj);
  if(isFinite(t_pred_cal_adj) && isFinite(cutoff) && cutoff>0){
    const diff = cutoff - t_pred_cal_adj;
    $('predCalNote').textContent = diff>=0 ? `✅ 關門內（餘裕 ${secondsToHMS(diff)}）` : `⚠️ 可能超過（差 ${secondsToHMS(-diff)}）`;
  }else{ $('predCalNote').textContent='—'; }
  $('predCalSteps').textContent =
`EP_race_cal = D + G/100 + Des/R_loss = ${fmt(D,2)} + ${fmt(G,0)}/100 + ${isFinite(Des)?fmt(Des,0):'0'}/${fmt(r_use,0)} = ${fmt(EP_race_cal,2)} ekm
以我的 EPH（校準） = ${fmt(EPHc,2)} ekm/h，先估 T_pred = ${secondsToHMS(t_pred_cal)}
耐力衰退：T_ref=${secondsToHMS(T_ref)}，r=T_pred/T_ref=${fmt(t_pred_cal/T_ref,2)} → F(r)=${fmt(Fc,3)}（下修 ${(1-Fc>0)?fmt((1-Fc)*100,1):'0'}%）
調整後 EPH = ${fmt(EPHc*Fc,2)}，加入緩衝 ${bufferPct||0}% → 預估 ${secondsToHMS(t_pred_cal_adj)}`;

  // 風險檢核（以校準版優先，否則用新手）
  const raceEP = isFinite(EP_race_cal) ? EP_race_cal : EP_race_basic;
  const predT = isFinite(t_pred_cal_adj) ? t_pred_cal_adj : t_pred_basic_adj;
  renderRisk(raceEP, predT);

  // 紀錄（避免刷太兇，只在有數值時）
  if(isFinite(t_pred_basic_adj) || isFinite(t_pred_cal_adj)){
    pushHistory({ ts:Date.now(), type:'完賽預估',
      summary:`Race ${fmt(D,2)}km/+${fmt(G,0)}m Des=${isFinite(Des)?fmt(Des,0):'-'}m → Pred ${secondsToHMS(t_pred_basic_adj)} / ${secondsToHMS(t_pred_cal_adj)}（cutoff ${secondsToHMS(cutoff)}）`
    });
  }
}

// ===== 風險檢核（紅黃綠） =====
function colorByRatio(x, g, y){ // green, yellow thresholds
  if(!isFinite(x)||x<=0) return {cls:'red', label:'資料不足'};
  if(x>=g) return {cls:'green', label:'良好'};
  if(x>=y) return {cls:'yellow', label:'注意'};
  return {cls:'red', label:'偏低'};
}
function renderRisk(raceEP, predT){
  const list = $('riskList');
  if(!list) return;
  const maxD=parseNum('maxLongD'), maxG=parseNum('maxLongG');
  const maxT=toSeconds($('maxLongTime').value.trim());
  const wkD=parseNum('wkAvgD'), wkG=parseNum('wkAvgG');

  const longEP = (Number(maxD)||0) + (Number(maxG)||0)/100;
  const wkEP   = (Number(wkD)||0) + (Number(wkG)||0)/100;

  const r1 = longEP>0 && raceEP>0 ? longEP/raceEP : NaN;
  const r2 = isFinite(maxT)&&isFinite(predT)&&predT>0 ? maxT/predT : NaN;
  const r3 = wkEP>0 && raceEP>0 ? wkEP/raceEP : NaN;
  const r4 = isFinite(wkG)&&isFinite(parseNum('raceG')) && parseNum('raceG')>0 ? wkG/parseNum('raceG') : NaN;

  const c1 = colorByRatio(r1, 0.40, 0.25);
  const c2 = colorByRatio(r2, 0.70, 0.50);
  const c3 = colorByRatio(r3, 0.90, 0.60);
  const c4 = colorByRatio(r4, 1.00, 0.60);

  const pct=(x)=> isFinite(x)? `${fmt(x*100,0)}%` : '—';

  list.innerHTML = [
    `<li><span class="dot ${c1.cls}"></span>單次最長 EP / 比賽 EP：${pct(r1)}（${c1.label}）</li>`,
    `<li><span class="dot ${c2.cls}"></span>單次最長時間 / 預估完賽：${pct(r2)}（${c2.label}）</li>`,
    `<li><span class="dot ${c3.cls}"></span>近 4 週平均 EP / 比賽 EP：${pct(r3)}（${c3.label}）</li>`,
    `<li><span class="dot ${c4.cls}"></span>近 4 週平均爬升 / 比賽爬升：${pct(r4)}（${c4.label}）</li>`
  ].join('');
}

// ===== 分享圖（透明 PNG，精簡格式） =====
async function makeSharePNG(){
  if(!LAST_STATE){ compute(); }
  const s = LAST_STATE || {};
  const chosenEPH = isFinite(s.EPH_cal) ? s.EPH_cal : s.EPH_basic;
  const ephText = `EPH ${fmt(chosenEPH,2)} ekm/h`;

  const canvas = $('shareCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const W=canvas.width, H=canvas.height;
  const x=64, y0=80, line=86;

  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 6;

  ctx.font = '700 56px system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans","PingFang TC","Microsoft JhengHei",sans-serif';
  ctx.fillText('Trail EPH', x, y0);

  ctx.shadowBlur = 0;
  ctx.font = '500 46px system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans","PingFang TC","Microsoft JhengHei",sans-serif';
  let y = y0 + line;
  ctx.fillText(`距離 ${fmt(s.D,2)} km`, x, y); y+=line;

  const desTxt = (isFinite(s.Des) && s.Des>0) ? ` | 下降 ${Math.round(s.Des)} m` : '';
  ctx.fillText(`爬升 +${Math.round(s.G||0)} m${desTxt}`, x, y); y+=line;

  ctx.fillText(`時間 ${secondsToHMS(s.T||0)}`, x, y); y+=line;

  ctx.font = '800 92px system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans","PingFang TC","Microsoft JhengHei",sans-serif';
  ctx.fillText(ephText, x, H-120);

  const toBlob = () => new Promise(res=>canvas.toBlob(res, 'image/png'));
  const blob = await toBlob();
  const url = URL.createObjectURL(blob);
  const a = $('downloadLink'); a.href = url; a.download = `eph_${Date.now()}.png`; a.click();

  if(location.protocol !== 'file:' && navigator.clipboard && window.ClipboardItem){
    try{ await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]); }catch(e){}
  }
}

// ===== 綁定與初始化 =====
document.addEventListener('DOMContentLoaded', ()=>{
  $('calcBtn').addEventListener('click', compute);
  $('resetBtn').addEventListener('click', ()=>{
    ['dist','gain','descent','time','pdown','pdownpace','gdown'].forEach(id=>$(id).value='');
    $('dist').value='8.33'; $('gain').value='536'; $('time').value='1:15:00';
    $('pflat').value='5:30'; $('rloss').value='250'; $('gdown').value='10';
    compute();
  });
  $('planBtn').addEventListener('click', ()=>{ plan(); predictFinish(); });
  $('clearHistoryBtn').addEventListener('click', ()=>{ localStorage.removeItem(HISTORY_KEY); renderHistory(); });
  $('shareBtn').addEventListener('click', makeSharePNG);

  // 風險輸入即時更新
  ['maxLongD','maxLongG','maxLongTime','wkAvgD','wkAvgG','raceD','raceG','raceDes','raceCutoff'].forEach(id=>{
    const el=$(id); if(el) el.addEventListener('input', ()=>predictFinish());
  });

  // 初次載入
  compute(); plan(); predictFinish(); renderHistory();

  // PWA（file:// 跳過）— 新版：偵測新 SW 接管就自動重新載入
  if (location.protocol !== 'file:' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(() => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });
      })
      .catch(() => {});
  }
});
