export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
export const fail=(status,msg)=>{throw new ApiError(status,msg);};
export function textField(x,n,max=200){if(typeof x!=='string'||!x.trim()||x.length>max||/[\x00-\x1f]/.test(x))fail(400,'Некорректное поле '+n);return x.trim();}
