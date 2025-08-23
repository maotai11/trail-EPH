// core/eph.js — 計算核心（純函式，Web/Android 可共用思想）
}


// 目標 EPH
export function target_eph_from_cutoff(D_km, G_m, Des_m, cutoff_sec, r_loss) {
const EP = ep_cal(D_km, G_m, Des_m, r_loss);
const hours = (Number(cutoff_sec)||0) / 3600.0;
if (hours <= 0) return NaN;
return EP / hours;
}


// 訓練段時間（由目標 EPH 推得）
export function train_time_from_target_eph(d_km, g_m, des_m, target_eph, r_loss) {
const EP_train = ep_cal(d_km, g_m, des_m, r_loss);
if (!isFinite(target_eph) || target_eph<=0) return NaN;
const hours = EP_train / target_eph;
return hours * 3600.0;
}


// R_loss 自動校準
export function calibrate_r_loss(total_time_sec, descent_m, p_down_pct, p_flat_sec_per_km, p_down_sec_per_km, g_down_percent) {
const T = Number(total_time_sec)||0;
const Des = Number(descent_m)||0;
const pDown = (Number(p_down_pct)||0)/100.0;
const Pflat = Number(p_flat_sec_per_km)||NaN;
const Pdown = Number(p_down_sec_per_km)||NaN;
const gDown = Number(g_down_percent)||NaN;


if (T<=0 || Des<=0 || pDown<=0 || !isFinite(Pflat)) {
return { rloss: NaN, method: 'insufficient', delta_down: NaN };
}


const Tdown = pDown * T;
let d_down_km;


if (isFinite(Pdown)) {
d_down_km = Tdown / Pdown; // km
} else {
// 以平均坡度估算水平距離
if (!isFinite(gDown) || gDown<=0) {
return { rloss: NaN, method: 'insufficient', delta_down: NaN };
}
// Des(m) / (坡度%) = 水平距離(米)；轉 km
d_down_km = (Des / (gDown/100.0)) / 1000.0;
}


const D_eq_down = Tdown / Pflat; // 以平路配速換算的等效公里數
const delta_down = Math.max(0, D_eq_down - d_down_km); // 額外成本（km）
if (delta_down <= 0) {
return { rloss: Infinity, method: isFinite(Pdown) ? 'pace_based' : 'slope_based', delta_down: 0 };
}
let rloss = Des / delta_down; // m per ekm
// 安全界限
if (rloss < 80) rloss = 80;
if (rloss > 800) rloss = 800;


return { rloss, method: isFinite(Pdown) ? 'pace_based' : 'slope_based', delta_down };
}