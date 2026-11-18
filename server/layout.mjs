import {fail} from './errors.mjs';
export function validateLayout(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>250)fail(400,'Раскладка: не более 250 элементов');
 const result={};
 for(const [key,box] of Object.entries(value)){
  if(!/^[a-zA-Z0-9_.:-]{1,160}$/.test(key)||!box||typeof box!=='object'||Array.isArray(box)||Object.keys(box).some(k=>!['width','height','x','y','order'].includes(k)))fail(400,'Некорректный элемент раскладки');
  const clean={};for(const [field,n] of Object.entries(box)){
   if(n===null)continue;const bounds=field==='width'?[32,3840]:field==='height'?[24,2400]:field==='order'?[0,4096]:[-3000,3000];
   if(!Number.isInteger(n)||n<bounds[0]||n>bounds[1])fail(400,'Некорректный размер или положение');clean[field]=n;
  }
  if(Object.keys(clean).length)Object.defineProperty(result,key,{value:clean,enumerable:true,configurable:true,writable:true});
 }
 return result;
}
