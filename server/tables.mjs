import {fail} from './errors.mjs';
const columnKeys={fleet:['name','status','smart','cpu','gpu','fan','ram','volume','problems','seen'],deliveries:['created','channel','phase','status','attempts','result']};
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const rowId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
export function validateTables(value){
 if(!record(value)||Object.keys(value).some(k=>!Object.hasOwn(columnKeys,k)))fail(400,'Неизвестная таблица');
 const result={};for(const [key,t]of Object.entries(value)){
  if(!record(t)||Object.keys(t).some(k=>!['columns','widths','rows','heights','manual'].includes(k)))fail(400,'Некорректные настройки таблицы');
  const clean={};if(t.columns!==undefined){if(!Array.isArray(t.columns)||t.columns.length!==columnKeys[key].length||new Set(t.columns).size!==t.columns.length||t.columns.some(k=>!columnKeys[key].includes(k)))fail(400,'Порядок должен включать все столбцы таблицы');clean.columns=[...t.columns];}
  if(t.widths!==undefined){if(!record(t.widths)||Object.entries(t.widths).some(([k,n])=>!columnKeys[key].includes(k)||!Number.isInteger(n)||n<64||n>1200))fail(400,'Ширина столбца: 64–1200 пикселей');clean.widths={...t.widths};}
  if(t.rows!==undefined){if(!Array.isArray(t.rows)||t.rows.length>2000||new Set(t.rows).size!==t.rows.length||t.rows.some(id=>!rowId(id)))fail(400,'Некорректный порядок строк');clean.rows=[...t.rows];}
  if(t.heights!==undefined){if(!record(t.heights)||Object.keys(t.heights).length>2000||Object.entries(t.heights).some(([id,n])=>!rowId(id)||!Number.isInteger(n)||n<48||n>600))fail(400,'Высота строки: 48–600 пикселей');clean.heights={...t.heights};}
  if(t.manual!==undefined){if(typeof t.manual!=='boolean')fail(400,'Некорректный режим порядка строк');clean.manual=t.manual;}
  result[key]=clean;
 }return result;
}
