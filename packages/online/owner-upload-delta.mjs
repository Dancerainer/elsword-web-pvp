/** Compact owner upload; canonical action/hit histories are never reduced.
 * Baselines are detached raw poses whose exact clock the server accepted.
 * Queue replacement and packet loss cannot promote an unacknowledged pose.
 */
import {createOwnerPoseDelta} from './owner-pose-delta.mjs';
import {validateOwnedState} from './owned-state.mjs';
export const OWNER_UPLOAD_DELTA_VERSION=1;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));

export function createOwnerUploadDelta({poseOptions={},poseVersion:defaultPoseVersion=1}={}){
  const codec=createOwnerPoseDelta({...poseOptions,validate:validateOwnedState});
  const encodedFrames=new Set(),maximumFrames=poseOptions.maximumSnapshots??24;
  let encodedEpoch=null,encodedFrame=-1,acknowledgedEpoch=null,acknowledgedFrame=-1,committedEpoch=null;
  const counts={encodedUploads:0,decodedUploads:0,acceptedBaselines:0};
  return {
    encode(owner,{poseVersion=defaultPoseVersion}={}){
      const report=validateOwnedState(owner);
      if(encodedEpoch!==report.epoch){
        if(encodedEpoch!==null&&report.epoch<encodedEpoch)throw Error('owner-upload-old-life');
        encodedEpoch=report.epoch;encodedFrame=-1;acknowledgedEpoch=null;acknowledgedFrame=-1;encodedFrames.clear();
      }
      const pose={...report,hits:[],actions:[]};delete pose.actionFrontierComplete;
      // validateOwnedState already detached the complete canonical tree. These
      // arrays belong only to the returned carrier, never to a raw pose base.
      const value={v:OWNER_UPLOAD_DELTA_VERSION,pose:codec.encode(pose,{acknowledgedEpoch,acknowledgedFrameSeq:acknowledgedFrame,version:poseVersion}),hits:report.hits,
        ...(Object.hasOwn(report,'actions')?{actions:report.actions}:{}),
        ...(Object.hasOwn(report,'actionFrontierComplete')?{actionFrontierComplete:report.actionFrontierComplete}:{})};
      encodedFrame=Math.max(encodedFrame,report.frameSeq);encodedFrames.add(report.frameSeq);
      while(encodedFrames.size>maximumFrames)encodedFrames.delete(encodedFrames.values().next().value);
      counts.encodedUploads++;return value;
    },
    acknowledge(receipt){
      if(!plain(receipt)||Object.keys(receipt).some(key=>!['epoch','frameSeq'].includes(key))
        ||receipt.epoch!==encodedEpoch||!integer(receipt.frameSeq)||receipt.frameSeq>encodedFrame||!encodedFrames.has(receipt.frameSeq)
        ||receipt.frameSeq<=(acknowledgedEpoch===receipt.epoch?acknowledgedFrame:-1))return false;
      acknowledgedEpoch=receipt.epoch;acknowledgedFrame=receipt.frameSeq;counts.acceptedBaselines++;return true;
    },
    decode(value){
      if(!plain(value)||value.v!==OWNER_UPLOAD_DELTA_VERSION||!plain(value.pose)||!Array.isArray(value.hits)||value.hits.length>128
        ||Object.keys(value).some(key=>!['v','pose','hits','actions','actionFrontierComplete'].includes(key))
        ||Object.hasOwn(value,'actions')&&(!Array.isArray(value.actions)||value.actions.length>16)
        ||Object.hasOwn(value,'actionFrontierComplete')&&typeof value.actionFrontierComplete!=='boolean')throw Error('invalid-owner-upload');
      const candidate=codec.decode(value.pose),report={...candidate.report,hits:value.hits};
      if(Object.hasOwn(value,'actions'))report.actions=value.actions;else delete report.actions;
      if(Object.hasOwn(value,'actionFrontierComplete'))report.actionFrontierComplete=value.actionFrontierComplete;
      // The production validator detaches this whole report once before any
      // caller sees it. A preliminary clone of each array would be discarded.
      const checked=validateOwnedState(report);counts.decodedUploads++;
      const epoch=checked.epoch,frameSeq=checked.frameSeq;
      return {report:checked,ownerReceipt:{epoch,frameSeq},commit(){
        // A legally accepted old-life RPC can complete after a new-life one.
        // Keep its canonical ACK, but never install its obsolete raw base.
        if(committedEpoch!==null&&epoch<committedEpoch)return false;
        candidate.commit();committedEpoch=epoch;return true;
      }};
    },
    reset(){codec.reset();encodedFrames.clear();encodedEpoch=acknowledgedEpoch=committedEpoch=null;encodedFrame=acknowledgedFrame=-1;},
    performance(){return {...counts,...codec.performance(),acknowledgedEpoch,acknowledgedFrame};},
  };
}
