import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='#platform')return {shortCircuit:true,url:'data:text/javascript,export const platform={getPreference:()=>null,setPreference:()=>{}}'};
 return next(specifier,context);
}});
const {energySavingStore,energySavingEnabled,setEnergySaving,renderEnergyPolicy,installBatteryMonitor}=await import('../apps/renderer/energy-saving.ts');
hooks.deregister();
test('auto uses not-charging OR below 30%; manual override wins',()=>{
 for(const [charging,level,expected] of [[true,.8,false],[true,.3,false],[true,.29,true],[false,.9,true]]){
  energySavingStore.setState({preference:'auto',battery:{charging,level}});assert.equal(energySavingEnabled(),expected);
 }
 setEnergySaving('off');energySavingStore.setState({battery:{charging:false,level:.1}});assert.equal(energySavingEnabled(),false);
 assert.equal(renderEnergyPolicy.maxInFlight(),2);assert.equal(renderEnergyPolicy.demandWindowMs(),60);
 setEnergySaving('on');assert.equal(renderEnergyPolicy.maxInFlight(),1);assert.equal(renderEnergyPolicy.demandWindowMs(),0);
 setEnergySaving('auto');assert.equal(energySavingEnabled(),true);
 energySavingStore.setState({battery:null});assert.equal(energySavingEnabled(),false);
});
test('battery monitor follows events and removes listeners on disposal',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;});
 const battery=Object.assign(new EventTarget(),{charging:true,level:.8});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getBattery:async()=>battery}});
 energySavingStore.setState({preference:'off',battery:null});
 const stop=installBatteryMonitor();await Promise.resolve();assert.equal(energySavingEnabled(),false);
 assert.equal(energySavingStore.getState().preference,'off','initial charging state must not clear manual choice');
 setEnergySaving('auto');
 battery.charging=false;battery.dispatchEvent(new Event('chargingchange'));assert.equal(energySavingEnabled(),true);
 setEnergySaving('off');battery.level=.1;battery.dispatchEvent(new Event('levelchange'));assert.equal(energySavingEnabled(),false);
 battery.charging=true;battery.dispatchEvent(new Event('chargingchange'));
 assert.equal(energySavingStore.getState().preference,'auto');
 assert.equal(energySavingEnabled(),true,'below 30% still enables energy saving when charging');
 battery.level=.8;battery.dispatchEvent(new Event('levelchange'));assert.equal(energySavingEnabled(),false);
 setEnergySaving('on');battery.dispatchEvent(new Event('chargingchange'));
 assert.equal(energySavingStore.getState().preference,'on','duplicate charging event is not a reconnection');
 battery.charging=false;battery.dispatchEvent(new Event('chargingchange'));
 battery.charging=true;battery.dispatchEvent(new Event('chargingchange'));
 assert.equal(energySavingStore.getState().preference,'auto');assert.equal(energySavingEnabled(),false);
 stop();battery.level=.9;battery.dispatchEvent(new Event('levelchange'));assert.equal(energySavingStore.getState().battery.level,.8);
 const cancelled=installBatteryMonitor();cancelled();await Promise.resolve();assert.equal(energySavingStore.getState().battery.level,.8);
});
