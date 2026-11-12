/** Offline reconstruction of the recovered 2016 group 0x19 player records.
 * Derived from static evidence for the original encoder
 * 0x329a3a20 / decoder 0x329a3dd0. This is not the Web production envelope.
 * Fields are addressed by original mask bit, not guessed business names.
 * binary16 fields contain their raw unsigned 16-bit representation; use the
 * explicit helpers below when converting a float32 coordinate.
 */
export const NATIVE2016_PLAYER_FULL_MASK=0x00ffffff;
export const NATIVE2016_PLAYER_FULL_BYTES=62;
export const NATIVE2016_PLAYER_SOURCE=Object.freeze({
 originalExecutableSha256:'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
 sourceSha256:'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba',
 encoder:'0x329a3a20',decoder:'0x329a3dd0',
 halfEncoder:'0x31f2f040',halfEncoderSha256:'87d425dae8d6ef244bc7c06992ce05d366dc3b36b0d43cb415408bcefae436b9',
 halfDecoder:'0x31f2f0d0',halfDecoderSha256:'353cf6a6f4f9e23482e8d7cbeccc51e1d6082823491799f7a29f861288fa8f1d',
 evidence:'static-original-instructions; no captured PvP traffic or original execution'
});
// Bit 22 precedes bit 3 on the wire. Never sort this table by bit number.
export const NATIVE2016_PLAYER_FIELDS=Object.freeze([
 [0,0x04,2,'u16'],[1,0x06,2,'u16'],[2,0x08,1,'u8'],[22,0x09,1,'u8'],
 [3,0x0a,2,'binary16'],[4,0x0c,4,'f32'],[5,0x10,2,'binary16'],[6,0x12,2,'u16'],
 [7,0x14,4,'f32'],[8,0x18,4,'f32'],[9,0x2e,1,'flags8'],[10,0x2f,2,'i16'],
 [11,0x31,2,'u16'],[12,0x33,1,'u8'],[13,0x34,1,'u8'],[14,0x35,1,'u8'],
 [15,0x36,4,'u32'],[16,0x1c,4,'f32'],[17,0x20,2,'binary16'],[18,0x22,4,'f32'],
 [19,0x26,2,'binary16'],[20,0x28,2,'u16'],[21,0x2a,4,'f32'],[23,0x3a,4,'u32']
].map(([maskBit,packedStateOffset,wireWidth,wireType])=>Object.freeze({maskBit,packedStateOffset,wireWidth,wireType})));
const scratch=new DataView(new ArrayBuffer(4));
const uint=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max;
/** Original bit-level helper. Unlike nearest-even half conversion, mantissa
 * bits are truncated. The original early-underflow branch returns positive
 * zero, including float32 -0. Raw bits permit NaN payload vectors to be tested.
 */
export function float32BitsToNative2016Half(bits){
 if(!uint(bits,0xffffffff))throw Error('native2016-float32-bits');
 const sign=(bits>>>16)&0x8000,exponent=((bits>>>23)&255)-112,mantissa=bits&0x7fffff;
 if(exponent<=0){if(exponent< -10)return 0;return sign|((mantissa|0x800000)>>(1-exponent)>>13);}
 if(exponent===143){if(mantissa===0)return sign|0x7c00;const payload=mantissa>>13;return sign|0x7c00|payload|(payload===0?1:0);}
 if(exponent>30)return sign|0x7c00;
 return sign|(exponent<<10)|(mantissa>>13);
}
export function float32ToNative2016Half(value){
 if(typeof value!=='number')throw Error('native2016-float32');scratch.setFloat32(0,value,true);return float32BitsToNative2016Half(scratch.getUint32(0,true));
}
export function native2016HalfToFloat32Bits(value){
 if(!uint(value,0xffff))throw Error('native2016-half');
 const sign=(value&0x8000)<<16;let exponent=(value>>>10)&31,mantissa=value&1023;
 if(exponent===0){
  if(mantissa===0)return sign>>>0;
  while(!(mantissa&1024)){mantissa<<=1;exponent--;}
  exponent++;mantissa&=1023;
 }else if(exponent===31)return (sign|0x7f800000|(mantissa<<13))>>>0;
 return (sign|((exponent+112)<<23)|(mantissa<<13))>>>0;
}
export function native2016HalfToFloat32(value){scratch.setUint32(0,native2016HalfToFloat32Bits(value),true);return scratch.getFloat32(0,true);}
function validateField(field,value){
 if(field.wireType==='f32'){if(typeof value!=='number')throw Error('native2016-player-field');return Math.fround(value);}
 if(field.wireType==='i16'){if(!Number.isInteger(value)||value< -32768||value>32767)throw Error('native2016-player-field');return value;}
 if(!uint(value,field.wireWidth===1?255:field.wireWidth===2?65535:4294967295))throw Error('native2016-player-field');return value;
}
function values(fields){
 if(!Array.isArray(fields)||fields.length!==24)throw Error('native2016-player-fields');
 const result=new Array(24);for(const field of NATIVE2016_PLAYER_FIELDS)result[field.maskBit]=validateField(field,fields[field.maskBit]);return result;
}
function put(view,offset,field,value){
 if(field.wireType==='f32')view.setFloat32(offset,value,true);
 else if(field.wireType==='i16')view.setInt16(offset,value,true);
 else if(field.wireWidth===1)view.setUint8(offset,value);
 else if(field.wireWidth===2)view.setUint16(offset,value,true);
 else view.setUint32(offset,value,true);
}
function get(view,offset,field){
 if(field.wireType==='f32')return view.getFloat32(offset,true);
 if(field.wireType==='i16')return view.getInt16(offset,true);
 if(field.wireWidth===1)return view.getUint8(offset);
 return field.wireWidth===2?view.getUint16(offset,true):view.getUint32(offset,true);
}
/** Complete fields indexed by original mask bit; half fields are raw words.
 * Floating comparisons match original FUCOMPP/TEST AH,0x44: +0 equals -0;
 * NaN always changes. All integer/half comparisons compare their raw values.
 */
export function encodeNative2016PlayerRecord(fields,{previous=null}={}){
 const current=values(fields),prior=previous===null?null:values(previous);let mask=0,size=4;
 for(const field of NATIVE2016_PLAYER_FIELDS)if(prior===null||current[field.maskBit]!==prior[field.maskBit]){mask|=1<<field.maskBit;size+=field.wireWidth;}
 const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);view.setUint32(0,mask,true);let offset=4;
 for(const field of NATIVE2016_PLAYER_FIELDS)if(mask&(1<<field.maskBit)){put(view,offset,field,current[field.maskBit]);offset+=field.wireWidth;}
 return bytes;
}
/** Decode one record from a group. Unsent fields remain undefined without a
 * previous record; accumulatedMask is ORed as in the original receiver. A
 * partial state must not be applied as a complete 2016 player state.
 */
export function decodeNative2016PlayerRecord(bytes,{previous=null,offset=0,allowTrailing=false}={}){
 if(!(bytes instanceof Uint8Array)||!Number.isSafeInteger(offset)||offset<0||bytes.length-offset<4)throw Error('native2016-player-truncated');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),mask=view.getUint32(offset,true);
 if(mask&~NATIVE2016_PLAYER_FULL_MASK)throw Error('native2016-player-mask');
 let accumulatedMask=0,fields=new Array(24);
 if(previous!==null){
  if(!previous||!uint(previous.accumulatedMask,NATIVE2016_PLAYER_FULL_MASK)||!Array.isArray(previous.fields)||previous.fields.length!==24)throw Error('native2016-player-baseline');
  accumulatedMask=previous.accumulatedMask;
  for(const field of NATIVE2016_PLAYER_FIELDS)if(accumulatedMask&(1<<field.maskBit))fields[field.maskBit]=validateField(field,previous.fields[field.maskBit]);
 }
 const start=offset;offset+=4;
 for(const field of NATIVE2016_PLAYER_FIELDS)if(mask&(1<<field.maskBit)){
  if(field.wireWidth>bytes.length-offset)throw Error('native2016-player-truncated');fields[field.maskBit]=get(view,offset,field);offset+=field.wireWidth;
 }
 if(!allowTrailing&&offset!==bytes.length)throw Error('native2016-player-trailing');
 accumulatedMask|=mask;return {mask,accumulatedMask,complete:accumulatedMask===NATIVE2016_PLAYER_FULL_MASK,fields,bytesRead:offset-start};
}
