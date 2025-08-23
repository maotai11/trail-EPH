// ===== 核心工具（單檔版） =====
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
  const h=Math.floor(T/3600);
  const m=Math.floor((T%3600)/60);
  const s=Math.round(T%60);
  const pad=n=>n.toString().padStart(2,'0');
  const hms=`${h}:${pad(m)}:${pad(s)}`;
  const hours=T/3600;
  const text=`T = ${hms} = ${h} h + ${m} m + ${s} s = ${h} + ${m}/60 + ${s}/3600 = ${hours.toFixed(3)} h`;
  return {h,m,s,hours,text};
}
function secondsToHMS(totalSec){
  if(!isFinite(totalSec)) return '—';
  const sign = totalSec<0?'-':'';
  totalSec = Math.abs(totalSec);
  const h=Math.floor(totalSec/3600);
  const m=Math.floor((totalSec%3600)/60);
  const s=Math.round(totalSec%60);
  const pad=n=>n.toString().padStart(2,'0');
  return `${sign}${h}:${pad(m)}:${pad(s)}`;
}
function paceToSecPerKm(paceStr){
  if(!paceStr) return NaN;
  const parts=paceStr.split(':').map(Number);
  if(parts.length!==2) return NaN;
  return parts[0]*60+parts[1];
}
function secPerKmToPace(sec){
  if(!isFinite(sec)||sec<=0) return '—';
  const m=Math.floor(sec/60), s=Math.round(sec%60);
  return `${m}:${s.toString().padStart(2,'0')}`;
}
function fmt(num, digits=2){ return isFinite(num)?Number(num).toFixed(digits):'—'; }
function parseNum(id){ const v=$(id).value.trim(); return v===''?NaN:Number(v); }
function parsePaceStr(id){ const v=$(id).value.trim(); return v?paceToSecPerKm(v):NaN; }

// ===== 新手版/校準版 計算 =====
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
  let r=Des/delta;
  if(r<80) r=80; if(r>800) r=800;
  return { rloss:r, method: isFinite(Pdown)?'pace_based':'slope_based', delta_down:delta };
}

// ===== 歷史（本機） =====
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

// ===== 狀態（分享圖使用） =====
let LAST_STATE = null;

// ===== UI 計算 =====
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

  LAST_STATE = {
    D, G, Des, T,
    EPH_basic: EPHb, EPH_cal: EPHc, r_use,
    mode: isFinite(EPHc) ? 'cal' : 'basic'
  };

  pushHistory({ ts:Date.now(), type:'EPH 計算',
    summary:`D=${fmt(D,2)}km, G=${fmt(G,0)}m, Des=${isFinite(Des)?fmt(Des,0):'-'}m, T=${secondsToHMS(T)}, EPH=${fmt(EPHb,2)} / EPH_cal=${fmt(EPHc,2)} (R_loss=${fmt(r_use,0)})`
  });
}

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

  pushHistory({ ts:Date.now(), type:'關門→訓練',
    summary:`Race ${fmt(D,2)}km/+${fmt(G,0)}m T=${secondsToHMS(cutoff)} → Train ${fmt(d,2)}km/+${fmt(g,0)}m : ${secondsToHMS(t_train_basic)} / ${secondsToHMS(t_train_cal)} (R_loss=${fmt(r_use,0)})`
  });
}

// ===== 分享圖（透明 PNG） =====
async function makeSharePNG(){
  if(!LAST_STATE){ compute(); }
  const s = LAST_STATE || {};
  const chosenEPH = isFinite(s.EPH_cal) ? s.EPH_cal : s.EPH_basic;
  const ephLabel  = isFinite(s.EPH_cal) ? 'EPH（校準）' : 'EPH（新手）';
  const desLine   = isFinite(s.Des) && s.Des>0 ? `下降 ${Math.round(s.Des)} m` : null;

  const canvas = $('shareCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const W=canvas.width, H=canvas.height;
  const cx=80, cy=120, line=90;

  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 6;
  ctx.font = 'bold 56px system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans", "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.fillText('Trail EPH', cx, cy);

  ctx.shadowBlur = 0;
  ctx.font = '400 42px system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans", "PingFang TC", "Microsoft JhengHei", sans-serif';
  let y=cy+line;
  ctx.fillText(`距離 ${fmt(s.D,2)} km`, cx, y); y+=line;
  ctx.fillText(`爬升 +${Math.round(s.G||0)} m`, cx, y); y+=line;
  if(desLine){ ctx.fillText(desLine, cx, y); y+=line; }
  ctx.fillText(`時間 ${secondsToHMS(s.T||0)}`, cx, y); y+=line;

  ctx.font = '700 76px system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans", "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.fillText(`${ephLabel}  ${fmt(chosenEPH,2)} ekm/h`, cx, H-120);

  const toBlob = () => new Promise(res=>canvas.toBlob(res, 'image/png'));
  const blob = await toBlob();
  const url = URL.createObjectURL(blob);
  const a = $('downloadLink'); a.href = url; a.download = `eph_${Date.now()}.png`; a.click();

  if(location.protocol !== 'file:' && navigator.clipboard && window.ClipboardItem){
    try{ await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]); }catch(e){}
  }
}

// ===== 綁定事件、初始化 =====
document.addEventListener('DOMContentLoaded', ()=>{
  $('calcBtn').addEventListener('click', compute);
  $('resetBtn').addEventListener('click', ()=>{
    ['dist','gain','descent','time','pdown','pdownpace','gdown'].forEach(id=>$(id).value='');
    $('dist').value='8.33'; $('gain').value='536'; $('time').value='1:15:00';
    $('pflat').value='5:30'; $('rloss').value='250'; $('gdown').value='10';
    compute();
  });
  $('planBtn').addEventListener('click', plan);
  $('clearHistoryBtn').addEventListener('click', ()=>{ localStorage.removeItem(HISTORY_KEY); renderHistory(); });
  $('shareBtn').addEventListener('click', makeSharePNG);

  // 初次載入
  compute(); plan(); renderHistory();

  // PWA：本機 file:// 跳過，部署到 http(s) 再啟用
  if(location.protocol!=='file:' && 'serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
});
