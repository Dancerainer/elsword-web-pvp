// IPC fault fixture only; no combat or original-client behavior is asserted.
let match,linger=false;
process.on('message',message=>{
  if(message.kind==='initialize'){
    match=message.match;
    if(match.id==='startup-pending')return;
    if(match.id==='startup-failure'){process.send({kind:'fatal',error:'fixture-startup-failure'});return;}
    process.send({kind:'ready',snapshot:{matchId:match.id,fixture:true,pid:process.pid}});
  }else if(message.kind==='stop'){process.disconnect();}
  else if(message.kind==='request'){
    if(message.method==='submitInput'){
      const batch=message.args[1];
      if(batch.stderrCrash){process.stderr.write('Error: fixture-private-detail\n'+('x'.repeat(20000))+'\nfixture-tail-marker\n',()=>process.exit(8));return;}
      if(batch.outputOverflow){process.send({kind:'fatal',error:'room-worker-output-overflow',detail:{pendingOutputMessages:256,pendingOutputBytes:1_000_000}});return;}
      if(batch.crash){process.exit(7);return;}
      if(batch.disconnect){linger=true;setInterval(()=>{},10000);process.disconnect();return;}
      setTimeout(()=>process.connected&&process.send({kind:'reply',id:message.id,value:{accepted:true,frameSeq:batch.sequence}}),batch.delay??0);
    }else process.send({kind:'reply',id:message.id,value:{ok:true}});
  }
});
process.on('disconnect',()=>{if(!linger)process.exit(0);});
