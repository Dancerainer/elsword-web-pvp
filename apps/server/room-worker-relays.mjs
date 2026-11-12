import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';

/** A poll lease can rotate while its acknowledged mailbox and token survive.
 * The token fences IPC deliveries and identifies the codec lifetime. */
export function updateRoomRelayBinding(peers,playerId,binding){
  if(!binding){peers.delete(playerId);return null;}
  const previous=peers.get(playerId);
  if(previous&&previous.token===binding.token&&previous.splitDeltas===binding.splitDeltas&&previous.deltaVersion===binding.deltaVersion){
    previous.generation=binding.generation;return previous;
  }
  const row={...binding,epochs:new Map(),lives:new Map(),roomLives:new Map(),deltas:createOwnedRelayDelta()};
  peers.set(playerId,row);return row;
}

// Rotation of a retained poll mailbox preserves its reliable events and
// token. An already encoded baseline may still be in IPC at that instant;
// discarding it by generation alone would strand every following delta.
export const isCurrentRoomPacket=(packet,relay)=>typeof packet?.token==='string'&&packet.token===relay.token;
