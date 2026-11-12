import source from '../../contracts/de-stardust-final-visual-v58.json' with {type:'json'};

/** Two final phases declare exactly the same original mesh bytes already
 * converted for another phase. Repair only their missing pose references;
 * retain each phase's own Size, motion, color, lifetime and damage declaration. */
export function completeAddStardustFinalVisuals(templates,id){
  if(id!=='DE')return;
  for(const row of source.poseBindings){
    const target=templates[row.target],donor=templates[row.donor];
    if(!target)continue;
    if(target.declarationSha256!==row.targetDeclaration||target.fields.MeshName!==row.mesh||
      donor?.declarationSha256!==row.donorDeclaration||donor.fields.MeshName!==row.mesh||donor.poseData!==row.poseData||
      donor.animationMissingTickRate||donor.animationRequiresUnconfirmedRate)throw TypeError('Stardust original mesh pose binding mismatch');
    if(target.poseData){if(target.poseData!==row.poseData)throw TypeError('Stardust conflicting pose artifact');continue;}
    templates[row.target]={...target,poseData:donor.poseData,animationClips:donor.animationClips,
      animationMissingTickRate:false,animationRequiresUnconfirmedRate:false,
      unsupported:target.unsupported.filter(message=>message!=='Measured native key artifact missing')};
  }
}
