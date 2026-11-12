import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

export function createResourceDeliveryStore({accountRoot, enabled=false, fileSystem=fs}) {
  if(typeof enabled!=='boolean')throw Error('invalid-resource-delivery');
  const file=path.join(accountRoot,'resource-delivery.json');
  let state={schemaVersion:1,revision:0,enabled},tail=Promise.resolve();
  const status=()=>({...state});
  return {status,async initialize(){
    try {
      const value=JSON.parse((await fileSystem.readFile(file,'utf8')).replace(/^\uFEFF/,''));
      if(!value||Object.keys(value).length!==3||value.schemaVersion!==1||typeof value.enabled!=='boolean'
        ||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('invalid-saved-resource-delivery');
      state=value;
    }catch(error){if(error.code!=='ENOENT')throw error;}
  },save(enabled){
    if(typeof enabled!=='boolean')return Promise.reject(Error('invalid-resource-delivery'));
    const operation=tail.then(async()=>{
      const next={schemaVersion:1,revision:state.revision+1,enabled};
      const temporary=file+'.'+randomBytes(6).toString('hex')+'.tmp';
      await fileSystem.mkdir(accountRoot,{recursive:true});
      try {
        await fileSystem.writeFile(temporary,JSON.stringify(next)+'\n',{flag:'wx',mode:0o600});
        await fileSystem.rename(temporary,file);state=next;return status();
      }finally{await fileSystem.rm(temporary,{force:true});}
    });
    tail=operation.catch(()=>{});return operation;
  }};
}
