/** Original2016 3273d1e0 scales only the main mesh; 31eebba0 applies
 * the display multiplier to the main mesh and its particle lists. This
 * display adapter consumes the current owner state without mutating it. */
export function createAddVoidCollapseDisplay(effect){
  const display={alpha:1};
  updateAddVoidCollapseDisplay(display,effect);
  return display;
}

/** Web presentation retains the last applied collapse value when its
 * CEffect lookup disappears. The original setter writes current particles;
 * retaining this value through AutoDie is the requested no-reappearance
 * lifecycle rule, not an original-client future-color/pixel claim. Storage
 * is held only by that parent's actual live emitters. */
export function updateAddVoidCollapseDisplay(display,effect){
  const alpha=effect?.sourceAddVoidCollapse?.alpha;
  if(alpha!==undefined)display.alpha=Math.min(display.alpha,alpha);
  return display;
}

/** Owned restoration can replace a recipient-local effect id. The canonical
 * owner/serial/source id still identifies this cast. Share its scalar across
 * those local handles; retain no entry after its actual finite emitters die. */
export function createAddVoidCollapseDisplayRegistry(){
  const records=new Map();
  return {
    acquire(parent,effect){
      const key=JSON.stringify([parent.ownerId,effect?.ownerStateSerial??parent.ownerStateSerial,effect?.networkId??parent.id]);
      const epoch=effect?.networkEpoch;let display=records.get(key);
      if(!display||display.epoch!==undefined&&epoch!==undefined&&display.epoch!==epoch){
        display={...createAddVoidCollapseDisplay(effect),emitters:new Set(),epoch};records.set(key,display);
      }else {if(epoch!==undefined)display.epoch=epoch;updateAddVoidCollapseDisplay(display,effect);}
      return display;
    },
    track(display,id){display.emitters.add(id);},
    prune(emitters){for(const [key,display]of records){
      for(const id of display.emitters)if(!emitters.has(id))display.emitters.delete(id);
      if(display.emitters.size===0)records.delete(key);
    }},
    clear(){records.clear();},get size(){return records.size;},
  };
}

export function addVoidCollapseColor(color,effect,retained){
  const current=effect?.sourceAddVoidCollapse?.alpha;
  const alpha=retained?Math.min(current??retained.alpha,retained.alpha):current;
  return alpha===undefined?color:[color[0],color[1],color[2],color[3]*alpha];
}
