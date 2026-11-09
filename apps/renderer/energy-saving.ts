/**
 * 两种渲染策略，区别在于视口持续变化时是否启动新 tiles：
 * - 普通模式：SDK 使用固定 60 ms 窗口合并需求，只提交窗口内最新视口；
 *   后续变化不重置窗口，持续滚动也能渐进补图，并发上限为 2。
 * - 节能模式：energy-motion 在每次视口变化后重置 120 ms 停稳定时器；
 *   移动期间暂停新增任务，停稳后立即补图（不叠加调度等待），并发为 1。
 * 两者都保留已有高清 Canvas，继续复用 SDK 缓存、去重和过期请求取消；
 * 不把中间视口的请求积压后逐个执行。普通模式优先响应，节能优先减少无效工作。
 * 节能时 DPR 固定 1.25；模式切换不重建文档，不清空缓存，也不改变保存/草稿行为。
 */
import { createStore } from 'zustand/vanilla';
import { platform } from '#platform';

type Preference = 'auto' | 'on' | 'off';
type BatteryState = { charging: boolean; level: number };
interface BatteryManager extends EventTarget, BatteryState {}
export const ENERGY_PREFERENCE_KEY = 'pdf-viewer-energy-saving-v1';
const KEY = ENERGY_PREFERENCE_KEY;
const stored = platform.getPreference(KEY);
export const energySavingStore = createStore<{ preference: Preference; battery: BatteryState | null }>(() => ({
  preference: stored === 'on' || stored === 'off' ? stored : 'auto', battery: null,
}));
export function energySavingEnabled(state = energySavingStore.getState()) {
  if (state.preference !== 'auto') return state.preference === 'on';
  return state.battery !== null && (!state.battery.charging || state.battery.level < 0.3);
}
export function setEnergySaving(preference: Preference) {
  platform.setPreference(KEY, preference);
  energySavingStore.setState({ preference });
}
// Read at scheduling time; switching never recreates the document or raster cache.
export const renderEnergyPolicy = {
  maxInFlight: () => energySavingEnabled() ? 1 : 2,
  demandWindowMs: () => energySavingEnabled() ? 0 : 60,
};
export function installBatteryMonitor() {
  let stopped = false;
  let battery: BatteryManager | undefined;
  let previousCharging: boolean | undefined;
  const update = () => {
    if (stopped || !battery) return;
    // Reset only on an observed reconnection, not initial discovery or level updates.
    const reconnected = previousCharging === false && battery.charging;
    previousCharging = battery.charging;
    if (reconnected) platform.setPreference(KEY, 'auto');
    energySavingStore.setState({
      battery: { charging: battery.charging, level: battery.level },
      ...(reconnected ? { preference: 'auto' as const } : {}),
    });
  };
  const navigatorWithBattery = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
  if (navigatorWithBattery.getBattery) {
    void navigatorWithBattery.getBattery().then(value => {
      if (stopped) return;
      battery = value;
      battery.addEventListener('chargingchange', update);
      battery.addEventListener('levelchange', update);
      update();
    }).catch(() => { if (!stopped) energySavingStore.setState({ battery: null }); });
  }
  return () => {
    stopped = true;
    battery?.removeEventListener('chargingchange', update);
    battery?.removeEventListener('levelchange', update);
  };
}
