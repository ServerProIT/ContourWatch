import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
import {Store} from './core.mjs';
import {encodePassword} from './platform.mjs';
// Local recovery only. Stop the server before using this command.
if(process.argv[2]!=='reset-password'){console.error('Использование: node server/admin.mjs reset-password [DATA_DIR]');process.exitCode=2;}
else {
 const dir=resolve(process.argv[3]||process.env.DATA_DIR||'data'),db=resolve(dir,'contour.db');
 if(!existsSync(db))throw Error('База панели не найдена');
 const s=new Store(db);
 try{const admin=s.one("SELECT id,username FROM users WHERE role='admin'");if(!admin)throw Error('Администратор не найден');
  const password=randomBytes(24).toString('base64url'),encoded=await encodePassword(password),file=resolve(dir,'admin-reset-'+Date.now()+'.txt');
  s.transaction(()=>{writeFileSync(file,`Логин: ${admin.username}\nВременный пароль: ${password}\nСмените пароль при входе.\n`,{mode:0o600,flag:'wx'});s.run('UPDATE users SET password=?,must_change=1,revision=revision+1 WHERE id=?',encoded,admin.id);s.audit({id:'local-recovery'},'user.password.reset',admin.id);});
  console.log('Пароль сброшен. Защищённый файл: '+file);
 }finally{s.close();}
}
