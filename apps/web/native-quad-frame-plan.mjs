/** Reusable, display-only native quad lists. Rows belong to live particles;
 * texture groups belong to their live emitter. No declaration, birth order,
 * Texture ID or DrawCount is changed. A returned frame is borrowed until the
 * next beginFrame(), so rendering must consume it synchronously.
 *
 * The old per-frame path rebuilt a row for every particle, then allocated a
 * filtered row array for every whole-texture DrawCount pass. Store each row
 * once and let the renderer repeat the group, skipping smaller DrawCounts.
 */
export function createNativeQuadFramePlan(){
  const rows=new WeakMap(),sequences=new Map(),active=[];
  let frame=0;
  const created={rows:0,sequences:0,textureGroups:0};
  return {
    beginFrame(){
      for(const sequence of active){
        for(const group of sequence.groups){group.rows.length=0;group.drawCount=0;}
        sequence.groups.length=0;
      }
      active.length=0;frame++;
    },
    append(p,path,textureId,drawCount,sequencePosition){
      const id=Number(textureId);
      if(!Number.isInteger(id))throw Error('Invalid native particle texture id');
      let sequence=sequences.get(p.emitterId);
      if(!sequence){
        sequence={emitterId:p.emitterId,frame:-1,byTexture:new Map(),groups:[]};
        sequences.set(p.emitterId,sequence);created.sequences++;
      }
      if(sequence.frame!==frame){sequence.frame=frame;active.push(sequence);}
      let group=sequence.byTexture.get(id);
      if(!group){
        group={textureId:id,frame:-1,drawCount:0,rows:[]};
        sequence.byTexture.set(id,group);created.textureGroups++;
      }
      if(group.frame!==frame){group.frame=frame;sequence.groups.push(group);}
      let row=rows.get(p);
      if(!row){row={p,matrix:new Float32Array(16)};rows.set(p,row);created.rows++;}
      row.path=path;row.textureId=id;row.drawCount=drawCount;row.sequencePosition=sequencePosition;
      group.rows.push(row);group.drawCount=Math.max(group.drawCount,drawCount);
      return row;
    },
    finishFrame(){
      // Release retired emitter groups immediately, including all references
      // to their last displayed particles. A long fight cannot retain every
      // historical sequence. Hidden emitters can rebuild on their next draw.
      for(const [id,sequence] of sequences)if(sequence.frame!==frame)sequences.delete(id);
      for(const sequence of active)sequence.groups.sort((a,b)=>a.textureId-b.textureId);
      return active;
    },
    clear(){
      for(const sequence of sequences.values()){
        for(const group of sequence.byTexture.values())group.rows.length=0;
        sequence.groups.length=0;
      }
      sequences.clear();active.length=0;frame++;
    },
    proof(){return {created:{...created},retainedSequences:sequences.size,activeSequences:active.length,
      activeTextureGroups:active.reduce((n,sequence)=>n+sequence.groups.length,0)};},
  };
}
