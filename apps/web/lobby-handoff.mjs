/** A single server-acknowledged transition. Asset preparation keeps the old
 * connection alive; only a valid rotated page token allows local retirement.
 * A failed request remains retryable with the original idempotency token. */
export function createLobbyHandoffRelease({requestHandoff,acceptToken,closeLocal,isClosed=()=>false}){
 let flight=null;
 return function release(){
  if(flight)return flight;if(isClosed())return Promise.resolve(null);
  flight=(async()=>{
   const ack=await requestHandoff();
   if(ack?.ok!==true||typeof ack.pageInitToken!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(ack.pageInitToken))
    throw TypeError('Invalid lobby handoff acknowledgement');
   acceptToken(ack.pageInitToken);closeLocal();return ack;
  })().catch(error=>{flight=null;throw error;});return flight;
 };
}
