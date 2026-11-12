/** Choose a loopback fixture port in the private range. On this Windows host,
 * listen(0) can return a port forbidden by Fetch (observed: "bad port").
 * Binding an ordinary private port keeps the real Fetch and server checks.
 */
import {randomInt} from 'node:crypto';
export async function listenLoopback(server){
  for(let attempt=0;attempt<20;attempt++){
    try{
      await new Promise((resolve,reject)=>{
        const onError=error=>reject(error);
        server.once('error',onError);
        server.listen(randomInt(49152,65536),'127.0.0.1',()=>{server.off('error',onError);resolve();});
      });
      return server.address().port;
    }catch(error){if(error.code!=='EADDRINUSE')throw error;}
  }
  throw Error('No free private loopback port for fixture');
}
