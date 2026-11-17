import {fail} from './errors.mjs';
export const widgetTypes=['device','metric','history','comparison','status','problems'];
export const chartKinds=['ram','cpu_load','temperature','gpu_load','gpu_temperature','gpu_memory_used','gpu_memory_total','gpu_fan','volume','disk_wear','fan','smart'];
export function validateDashboard(value){
 if(!value||value.version!==1||!Array.isArray(value.widgets)||value.widgets.length>40||Object.keys(value).some(k=>!['version','widgets'].includes(k)))fail(400,'Некорректная Главная: до 40 блоков');
 const ids=new Set();return {version:1,widgets:value.widgets.map(w=>{
  if(!w||typeof w!=='object'||Array.isArray(w)||Object.keys(w).some(k=>!['id','type','title','devices','metric','kind','period'].includes(k)))fail(400,'Некорректный блок');
  if(typeof w.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(w.id)||ids.has(w.id)||!widgetTypes.includes(w.type))fail(400,'Некорректный тип или ID блока');ids.add(w.id);
  if(typeof w.title!=='string'||w.title.length>80||/[\u0000-\u001f]/.test(w.title))fail(400,'Название блока: до 80 символов');
  if(!Array.isArray(w.devices)||!w.devices.length||w.devices.length>24||new Set(w.devices).size!==w.devices.length||w.devices.some(d=>typeof d!=='string'||!/^[a-f0-9-]{36}$/.test(d)))fail(400,'Выберите от 1 до 24 устройств');
  if(['device','metric','history'].includes(w.type)&&w.devices.length!==1)fail(400,'Для этого блока выберите один ПК');
  const result={id:w.id,type:w.type,title:w.title.trim(),devices:[...w.devices]};
  if(['metric','history'].includes(w.type)){if(typeof w.metric!=='string'||!w.metric.length||w.metric.length>240||/[\u0000-\u001f]/.test(w.metric))fail(400,'Выберите датчик');result.metric=w.metric;}
  if(w.type==='comparison'){if(!chartKinds.includes(w.kind))fail(400,'Неизвестный показатель сравнения');result.kind=w.kind;}
  if(w.type==='history'){if(![1,6,24,168].includes(w.period))fail(400,'Неизвестный период');result.period=w.period;}
  return result;
 })};
}
